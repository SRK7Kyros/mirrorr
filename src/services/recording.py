"""Recording lifecycle: stash segments during streaming, remux on finalize."""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING

from loguru import logger

from src.services.process_bus import ProcessBus, ProcessExit, ProcessOutput
from src.services.managed_process import ManagedProcess

if TYPE_CHECKING:
    from nats.aio.client import Client as NATS
    from src.storage.models import Session
    from src.startup.config import MirrorrSettings


@dataclass
class RecordingManager:
    """Handles segment stashing and remux-to-MP4 for recorded sessions.

    Composed into SessionSupervisor. Owns the stash task and remux logic.
    The remux ffmpeg process runs as a full ManagedProcess with telemetry,
    structured log capture, and progress tracking.
    """

    session_id: int
    session: Session
    settings: MirrorrSettings
    session_folder: Path
    stash_folder: Path
    segments_folder: Path
    bus: ProcessBus
    logs_folder: Path
    nc: "NATS | None" = None

    # internal state
    _stash_task: asyncio.Task | None = field(default=None, init=False, repr=False)
    _stash_seen: set[str] = field(default_factory=set, init=False, repr=False)
    _segment_count: int = field(default=0, init=False, repr=False)
    _stash_batch: int = field(default=0, init=False, repr=False)
    _remux_proc: ManagedProcess | None = field(default=None, init=False, repr=False)
    _remux_tasks: list[asyncio.Task] = field(default_factory=list, init=False, repr=False)
    _telemetry_tasks: list[asyncio.Task] = field(default_factory=list, init=False, repr=False)

    # ── stash lifecycle ─────────────────────────────────────────────

    def start_stash(self) -> None:
        """Start background task that copies oldest segments to stash
        before ffmpeg's delete_segments flag removes them."""
        self._segment_count = self.settings.hls_window // self.settings.segment_duration
        self._stash_batch = max(1, int(0.10 * self._segment_count))
        self.stash_folder.mkdir(exist_ok=True)
        self._stash_seen.clear()
        self._stash_task = asyncio.create_task(self._stash_loop())
        logger.info(
            f"Session {self.session_id}: recording stash task started "
            f"(batch={self._stash_batch}, window={self._segment_count} segments)"
        )

    async def stop_stash(self) -> None:
        """Cancel the stash task and do one final copy."""
        if self._stash_task and not self._stash_task.done():
            self._stash_task.cancel()
            try:
                await self._stash_task
            except asyncio.CancelledError:
                pass

    async def _stash_loop(self) -> None:
        interval = self.settings.segment_duration * self._stash_batch
        try:
            while True:
                await asyncio.sleep(interval)
                await self._stash_batch_copy()
        except asyncio.CancelledError:
            await self._stash_batch_copy()

    async def _stash_batch_copy(self) -> None:
        segments = sorted(self.segments_folder.glob("*.ts"))
        batch = segments[: self._stash_batch]
        for seg in batch:
            name = seg.name
            if name not in self._stash_seen:
                dest = self.stash_folder / name
                if not dest.exists():
                    try:
                        shutil.copy2(seg, dest)
                    except FileNotFoundError:
                        logger.debug(f"Segment {name} deleted before stash, skipping")
                self._stash_seen.add(name)

    # ── remux ───────────────────────────────────────────────────────

    async def remux(self) -> int:
        """Concatenate stash + remaining segments into MP4 via ManagedProcess,
        track progress with telemetry, move to recordings, create Recording DB
        entry. Returns the recording ID."""
        # 1. Gather and deduplicate segments
        stash_segments = (
            sorted(self.stash_folder.glob("*.ts"))
            if self.stash_folder.exists()
            else []
        )
        live_segments = sorted(self.segments_folder.glob("*.ts"))
        stash_names = {s.name for s in stash_segments}
        live_only = [s for s in live_segments if s.name not in stash_names]
        ordered = stash_segments + live_only

        if not ordered:
            raise RuntimeError("No segments found to remux")

        logger.info(
            f"Session {self.session_id}: remuxing {len(ordered)} segments "
            f"({len(stash_segments)} from stash + {len(live_only)} from live)"
        )

        # 2. Write concat list
        mp4_name = self.session_folder.name + ".mp4"
        mp4_path = self.session_folder / mp4_name
        concat_list = self.session_folder / "concat.txt"

        with open(concat_list, "w") as f:
            for seg in ordered:
                f.write(f"file '{seg.resolve()}'\n")

        ffmpeg_bin = os.environ.get("FFMPEG_EXECUTABLE") or shutil.which("ffmpeg")
        if not ffmpeg_bin:
            raise RuntimeError("ffmpeg not found")

        # 3. Create and start ManagedProcess for remux
        self._remux_proc = ManagedProcess(
            name="remux",
            command=[
                ffmpeg_bin,
                "-hide_banner", "-loglevel", "info", "-stats",
                "-f", "concat", "-safe", "0", "-i", str(concat_list),
                "-c", "copy", str(mp4_path),
            ],
            bus=self.bus,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        self._remux_proc.set_log_dir(self.logs_folder)

        # Wire telemetry forwarding to NATS (same pattern as supervisor)
        if self.nc:
            self._wire_remux_telemetry()

        # Spawn progress coordinator before starting the process
        progress_task = asyncio.create_task(
            self._remux_progress_coordinator(ordered)
        )
        self._remux_tasks.append(progress_task)

        await self._remux_proc.start()

        # 4. Wait for the remux process to exit
        exit_q = self.bus.subscribe("proc.remux.exit")
        exit_event: ProcessExit = await exit_q.get()

        # Give progress coordinator a moment to flush final summary
        if progress_task and not progress_task.done():
            try:
                await asyncio.wait_for(progress_task, timeout=2.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                pass

        # Clean up coordinator tasks
        for t in self._remux_tasks:
            if not t.done():
                t.cancel()
        if self._remux_tasks:
            await asyncio.gather(*self._remux_tasks, return_exceptions=True)
        self._remux_tasks.clear()

        # Clean up telemetry tasks
        for t in self._telemetry_tasks:
            if not t.done():
                t.cancel()
        if self._telemetry_tasks:
            await asyncio.gather(*self._telemetry_tasks, return_exceptions=True)
        self._telemetry_tasks.clear()

        # Close ManagedProcess internals
        await self._remux_proc.close()

        if exit_event.returncode != 0:
            raise RuntimeError(f"ffmpeg concat failed (code {exit_event.returncode})")

        logger.success(
            f"Session {self.session_id}: remux complete — {len(ordered)} segments → {mp4_name}"
        )

        # 5. Move to recordings dir
        recordings_dir = self.settings.recordings_dir
        recordings_dir.mkdir(parents=True, exist_ok=True)
        dest = recordings_dir / self.session_folder.name
        if dest.exists():
            i = 2
            while dest.exists():
                dest = recordings_dir / f"{self.session_folder.name}_{i}"
                i += 1

        # Clean up temp files before moving
        concat_list.unlink(missing_ok=True)
        (self.session_folder / "stream.m3u8").unlink(missing_ok=True)
        if self.stash_folder.exists():
            shutil.rmtree(self.stash_folder)
        for seg in self.segments_folder.iterdir():
            seg.unlink()
        self.segments_folder.rmdir()

        shutil.move(str(self.session_folder), str(dest))
        logger.info(f"Session {self.session_id}: moved to {dest}")

        # 6. Create Recording DB entry
        recording_id = await self._create_recording_entry(dest, mp4_name)
        return recording_id

    # ── remux progress tracking ──────────────────────────────────────

    # ffmpeg -stats progress line patterns:
    #   frame= 1234 fps= 50 ... speed=2.50x
    #   size=   1234kB time=00:01:23.45 bitrate= 123.4kbits/s speed=2.50x
    _FFMPEG_PROGRESS_RE = re.compile(
        r"frame=\s*(?P<frame>\d+).*?"
        r"time=\s*(?P<time>\d{2}:\d{2}:\d{2}\.\d+).*?"
        r"speed=\s*(?P<speed>[\d.]+)x"
    )
    _FFMPEG_SIZE_RE = re.compile(r"size=\s*(?P<size>\d+)(?P<unit>kB|MB|GB)?")
    _FFMPEG_BITRATE_RE = re.compile(r"bitrate=\s*(?P<bitrate>[\d.]+)kbits/s")

    def _wire_remux_telemetry(self) -> None:
        """Forward remux process telemetry to NATS."""
        if not self.nc or not self._remux_proc:
            return
        telemetry_q = self.bus.subscribe("proc.remux.telemetry")
        nc = self.nc  # capture for type narrowing in closure

        async def _forward():
            while True:
                data = await telemetry_q.get()
                subject = f"session.{self.session_id}.telemetry.remux"
                try:
                    await nc.publish(subject, json.dumps(data).encode())
                except Exception:
                    return

        self._telemetry_tasks.append(asyncio.create_task(_forward()))

    async def _remux_progress_coordinator(
        self, segments: list[Path]
    ) -> None:
        """Subscribe to remux stderr, parse ffmpeg progress, and emit
        periodic summary logs with percentage, ETA, and speed."""
        stderr_q = self.bus.subscribe("proc.remux.stderr")
        exit_q = self.bus.subscribe("proc.remux.exit")

        # Estimate total duration from segment count * segment_duration
        total_duration = len(segments) * self.settings.segment_duration
        start_time = datetime.now()
        last_summary_time = start_time
        summary_interval = 5.0  # seconds between summary logs

        last_progress: dict = {}

        while True:
            # Check if process exited
            if not exit_q.empty():
                break

            try:
                event: ProcessOutput = await asyncio.wait_for(
                    stderr_q.get(), timeout=1.0
                )
            except asyncio.TimeoutError:
                continue

            line = event.line
            if not line:
                continue

            # Parse progress line
            progress_match = self._FFMPEG_PROGRESS_RE.search(line)
            if progress_match:
                current_time = self._parse_ffmpeg_time(progress_match.group("time"))
                speed = float(progress_match.group("speed"))
                frame = int(progress_match.group("frame"))

                last_progress = {
                    "time": current_time,
                    "speed": speed,
                    "frame": frame,
                    "line": line,
                }

                # Check if it's time for a summary
                now = datetime.now()
                elapsed = (now - last_summary_time).total_seconds()
                if elapsed >= summary_interval:
                    last_summary_time = now
                    await self._log_remux_summary(
                        last_progress, total_duration, start_time
                    )

        # Final summary
        if last_progress:
            await self._log_remux_summary(
                last_progress, total_duration, start_time, final=True
            )

    async def _log_remux_summary(
        self,
        progress: dict,
        total_duration: float,
        start_time: datetime,
        final: bool = False,
    ) -> None:
        """Emit a summary log line with percentage, ETA, and speed."""
        current_time = progress.get("time", 0.0)
        speed = progress.get("speed", 0.0)
        frame = progress.get("frame", 0)

        # Calculate percentage
        if total_duration > 0:
            pct = min(100.0, (current_time / total_duration) * 100)
        else:
            pct = 0.0

        # Calculate ETA
        elapsed = (datetime.now() - start_time).total_seconds()
        eta_seconds: float | None = None
        if speed > 0 and total_duration > 0:
            remaining = total_duration - current_time
            eta_seconds = remaining / speed
            eta_str = self._format_duration(eta_seconds)
        else:
            eta_str = "?"

        # Format current/total time
        current_str = self._format_duration(current_time)
        total_str = self._format_duration(total_duration)

        # Format speed
        speed_str = f"{speed:.2f}x" if speed > 0 else "?"

        # Build summary line
        if final:
            summary = (
                f"Session {self.session_id}: remux complete — "
                f"{frame} frames, {current_str}/{total_str}, "
                f"{speed_str} speed, {elapsed:.1f}s total"
            )
            logger.success(summary)
        else:
            summary = (
                f"Session {self.session_id}: remux progress — "
                f"{pct:.1f}%, {frame} frames, "
                f"{current_str}/{total_str}, "
                f"{speed_str} speed, ETA {eta_str}"
            )
            logger.info(summary)

        # Emit to NATS for real-time UI updates
        if self.nc:
            try:
                await self.nc.publish(
                    f"session.{self.session_id}.remux.progress",
                    json.dumps({
                        "percent": round(pct, 1),
                        "frame": frame,
                        "current_time": current_time,
                        "total_duration": total_duration,
                        "speed": speed,
                        "elapsed": elapsed,
                        "eta_seconds": eta_seconds if speed > 0 else None,
                    }).encode(),
                )
            except Exception:
                pass

    def _parse_ffmpeg_time(self, time_str: str) -> float:
        """Parse ffmpeg time string (HH:MM:SS.ms) to seconds."""
        try:
            parts = time_str.split(":")
            hours = float(parts[0])
            minutes = float(parts[1])
            seconds = float(parts[2])
            return hours * 3600 + minutes * 60 + seconds
        except (ValueError, IndexError):
            return 0.0

    def _format_duration(self, seconds: float) -> str:
        """Format seconds to MM:SS or HH:MM:SS."""
        if seconds < 0:
            seconds = 0
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        if hours > 0:
            return f"{hours}:{minutes:02d}:{secs:02d}"
        return f"{minutes}:{secs:02d}"

    async def _probe_duration(self, path: Path) -> float:
        ffprobe_bin = os.environ.get("FFPROBE_EXECUTABLE") or shutil.which("ffprobe")
        if not ffprobe_bin:
            logger.warning("ffprobe not found — falling back to wall-clock duration")
            return 0.0

        proc = await asyncio.create_subprocess_exec(
            ffprobe_bin,
            "-v", "quiet", "-print_format", "json", "-show_format", str(path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await proc.communicate()
        if proc.returncode != 0:
            return 0.0

        try:
            info = json.loads(stdout)
            return float(info["format"]["duration"])
        except (KeyError, json.JSONDecodeError, ValueError):
            return 0.0

    async def _create_recording_entry(self, dest: Path, mp4_name: str) -> int:
        """Create the recording DB entry. Returns the recording ID."""
        from src.storage.database import create_db_engine
        from src.storage.models import Recording
        from src.storage import crud
        from src.api.auth import subscribe_requester

        mp4_in_dest = dest / mp4_name
        stat = mp4_in_dest.stat()
        started_at = self.session.started_at or datetime.utcnow()
        ended_at = datetime.utcnow()
        duration_seconds = await self._probe_duration(mp4_in_dest)

        db_engine, session_factory = create_db_engine(self.settings)
        try:
            async with session_factory() as db:
                recording = Recording(
                    user_friendly_name=self.session.profile.name,
                    snake_case_name=dest.name,
                    disk_path=str(dest),
                    content_url=f"{self.settings.web_url}/content/recordings/{dest.name}/{dest.name}.mp4",
                    profile_name=self.session.profile.name,
                    engine_name=self.session.engine.name,
                    resolver_name=self.session.profile.resolver.name,
                    started_at=started_at,
                    ended_at=ended_at,
                    duration_seconds=duration_seconds,
                    size_bytes=stat.st_size,
                    requester_user_token=self.session.requester_user_token,
                )
                recording = await crud.create(db, recording)
                await subscribe_requester(
                    db, self.session.requester_user_token,
                    "recording", recording.id,
                )
                await db.commit()
                recording_id = recording.id
        finally:
            await db_engine.dispose()

        return recording_id
