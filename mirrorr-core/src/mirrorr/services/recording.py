"""Recording lifecycle: stash segments during streaming, remux on finalize."""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import traceback
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

from loguru import logger

from mirrorr.services.process_bus import ProcessBus, ProcessExit, ProcessOutput
from mirrorr.services.managed_process import ManagedProcess

if TYPE_CHECKING:
    from nats.aio.client import Client as NATS
    from mirrorr.storage.models import Session
    from mirrorr.startup.config import MirrorrSettings


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
        before ffmpeg's delete_segments flag removes them.

        Idempotent: ``enable_recording`` can fire while the attempt is still
        bootstrapping, and the attempt then calls this again — a second task
        would overwrite the handle and the first loop would never be stopped.
        """
        if self._stash_task and not self._stash_task.done():
            return
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
        """Cancel the stash task and do one final copy.

        A stash task that already failed re-raises its exception when awaited;
        that must never escape: this runs at the top of ``_cleanup`` and an
        ENOSPC/EIO raised here would orphan the encoder processes.
        """
        if self._stash_task is None:
            return
        if not self._stash_task.done():
            self._stash_task.cancel()
        try:
            await self._stash_task
        except asyncio.CancelledError:
            pass
        except Exception as error:
            logger.warning(f"Session {self.session_id}: stash task failed: {error}")

    async def _stash_loop(self) -> None:
        interval = self.settings.segment_duration * self._stash_batch
        try:
            while True:
                await asyncio.sleep(interval)
                await self._stash_batch_copy()
        except asyncio.CancelledError:
            await self._stash_batch_copy()

    async def _stash_batch_copy(self) -> None:
        # Directory glob is sync I/O — run in a thread to avoid blocking.
        loop = asyncio.get_running_loop()
        segments = sorted(await loop.run_in_executor(None, lambda: list(self.segments_folder.glob("*.ts"))))
        batch = segments[: self._stash_batch]
        for seg in batch:
            name = seg.name
            if name not in self._stash_seen:
                dest = self.stash_folder / name
                if not dest.exists():
                    try:
                        await asyncio.get_running_loop().run_in_executor(None, shutil.copy2, seg, dest)
                        self._stash_seen.add(name)
                    except FileNotFoundError:
                        logger.debug(f"Segment {name} deleted before stash, skipping")
                else:
                    self._stash_seen.add(name)

    # ── remux ───────────────────────────────────────────────────────

    def use_folder(self, folder: Path) -> None:
        self.session_folder = folder
        self.stash_folder = folder / "stash"
        self.segments_folder = folder / "segments"
        self.logs_folder = folder / "logs"

    async def remux_capture(self) -> Path | None:
        """This capture's segments → one MP4 in its own folder, or ``None`` if it
        captured nothing.

        The artifact is an input to the session's final merge, so it stays where
        it was written (no move, no Recording row) until the session ends.
        """
        ordered = await self._ordered_segments()
        if not ordered:
            return None

        logger.info(f"Session {self.session_id}: remuxing {len(ordered)} capture segments")
        target = self.session_folder / f"{self.session_folder.name}.mp4"
        await self._concat(
            ordered,
            target,
            total_duration=len(ordered) * self.settings.segment_duration,
        )
        logger.success(
            f"Session {self.session_id}: capture remuxed — {len(ordered)} segments → {target.name}"
        )
        return target

    async def _ordered_segments(self) -> list[Path]:
        """The capture's segments in play order: the stash first, then the live window."""
        loop = asyncio.get_running_loop()
        stash_segments = (
            sorted(await loop.run_in_executor(None, lambda: list(self.stash_folder.glob("*.ts"))))
            if self.stash_folder.exists()
            else []
        )
        live_segments = sorted(await loop.run_in_executor(None, lambda: list(self.segments_folder.glob("*.ts"))))
        stash_names = {s.name for s in stash_segments}
        return stash_segments + [s for s in live_segments if s.name not in stash_names]

    async def finalize(self, artifacts: list[Path], capture: dict | None = None) -> int:
        """Merge the captures' artifacts into one recording, then file it.

        One artifact is a copy; several are concatenated in capture order. Two
        captures can differ in codec, so a failed stream copy keeps the longest
        artifact as the recording rather than losing the whole session to a
        container detail.
        """
        existing = [p for p in artifacts if p.exists()]
        if not existing:
            raise RuntimeError("No recording produced")

        target = self.session_folder / f"{self.session_folder.name}.mp4"
        if len(existing) == 1:
            if existing[0] != target:
                await asyncio.to_thread(shutil.copy2, existing[0], target)
        else:
            logger.info(f"Session {self.session_id}: merging {len(existing)} captures")
            total = sum([await self.probe_duration(p) for p in existing])
            merged = self.session_folder / f"{target.name}.part"
            try:
                await self._concat(existing, merged, total_duration=total)
                await asyncio.to_thread(merged.replace, target)
            except Exception as e:
                merged.unlink(missing_ok=True)
                logger.error(
                    f"Session {self.session_id}: capture merge failed ({e}) — keeping the longest"
                )
                keeper = max(existing, key=lambda p: p.stat().st_size)
                if keeper != target:
                    await asyncio.to_thread(shutil.copy2, keeper, target)

        mp4_name = target.name
        recordings_dir = self.settings.recordings_dir
        recordings_dir.mkdir(parents=True, exist_ok=True)
        dest = recordings_dir / self.session_folder.name
        i = 2
        while dest.exists():
            dest = recordings_dir / f"{self.session_folder.name}_{i}"
            i += 1

        (self.session_folder / "concat.txt").unlink(missing_ok=True)
        (self.session_folder / "stream.m3u8").unlink(missing_ok=True)

        await asyncio.get_running_loop().run_in_executor(None, shutil.move, str(self.session_folder), str(dest))
        logger.info(f"Session {self.session_id}: moved to {dest}")

        recording_id = await self._create_recording_entry(dest, mp4_name, capture)

        # A failed capture's folder is spent: its media is in the merged file.
        for folder in {p.parent for p in existing if p.parent != self.session_folder}:
            await asyncio.to_thread(shutil.rmtree, folder, ignore_errors=True)

        try:
            dest_stash = dest / "stash"
            if dest_stash.exists():
                await asyncio.to_thread(shutil.rmtree, dest_stash)
            dest_segments = dest / "segments"
            if dest_segments.exists():
                def _cleanup_segments():
                    for seg in dest_segments.iterdir():
                        seg.unlink()
                    dest_segments.rmdir()
                await asyncio.to_thread(_cleanup_segments)
        except Exception as e:
            logger.warning(f"Failed to clean up segments for session {self.session_id}: {e}")

        return recording_id

    async def _concat(self, sources: list[Path], out: Path, *, total_duration: float) -> None:
        concat_list = self.session_folder / "concat.txt"

        def _write_concat():
            with open(concat_list, "w") as f:
                for path in sources:
                    f.write(f"file '{path.resolve()}'\n")

        await asyncio.to_thread(_write_concat)

        ffmpeg_bin = os.environ.get("FFMPEG_EXECUTABLE") or await asyncio.to_thread(shutil.which, "ffmpeg")
        if not ffmpeg_bin:
            raise RuntimeError("ffmpeg not found")

        self._remux_proc = ManagedProcess(
            name="remux",
            command=[
                ffmpeg_bin,
                "-hide_banner", "-loglevel", "info", "-stats",
                "-f", "concat", "-safe", "0", "-i", str(concat_list),
                "-c", "copy", str(out),
            ],
            bus=self.bus,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        self._remux_proc.set_log_dir(self.logs_folder)

        if self.nc:
            self._wire_remux_telemetry()

        progress_task = asyncio.create_task(self._remux_progress_coordinator(total_duration))
        self._remux_tasks.append(progress_task)

        await self._remux_proc.start()
        exit_q = self.bus.subscribe("proc.remux.exit")
        exit_event: ProcessExit = await exit_q.get()

        # Give progress coordinator a moment to flush final summary
        if progress_task and not progress_task.done():
            try:
                await asyncio.wait_for(progress_task, timeout=2.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                pass

        for t in self._remux_tasks:
            if not t.done():
                t.cancel()
        if self._remux_tasks:
            await asyncio.gather(*self._remux_tasks, return_exceptions=True)
        self._remux_tasks.clear()

        for t in self._telemetry_tasks:
            if not t.done():
                t.cancel()
        if self._telemetry_tasks:
            await asyncio.gather(*self._telemetry_tasks, return_exceptions=True)
        self._telemetry_tasks.clear()

        await self._remux_proc.close()

        if exit_event.returncode != 0:
            raise RuntimeError(f"ffmpeg concat failed (code {exit_event.returncode})")

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
        topic = "proc.remux.telemetry"
        telemetry_q = self.bus.subscribe(topic)
        nc = self.nc  # alias so the closure keeps a narrowed type

        async def _forward():
            while True:
                data = await telemetry_q.get()
                subject = f"session.{self.session_id}.telemetry.remux"
                try:
                    await nc.publish(subject, json.dumps(data).encode())
                except Exception:
                    self.bus.unsubscribe(topic, telemetry_q)
                    return

        self._telemetry_tasks.append(asyncio.create_task(_forward()))

    async def _remux_progress_coordinator(self, total_duration: float) -> None:
        """Subscribe to remux stderr, parse ffmpeg progress, and emit
        periodic summary logs with percentage, ETA, and speed."""
        stderr_q = self.bus.subscribe("proc.remux.stderr")
        exit_q = self.bus.subscribe("proc.remux.exit")
        start_time = datetime.now(timezone.utc)
        last_summary_time = start_time
        summary_interval = 5.0  # seconds between summary logs

        last_progress: dict = {}

        try:
            await self._coordinator_loop(stderr_q, exit_q, total_duration, start_time, last_summary_time, summary_interval, last_progress)
        except Exception as e:
            logger.error(
                f"Session {self.session_id}: remux coordinator crashed: {e!r}\n{traceback.format_exc()}"
            )

    async def _coordinator_loop(
        self,
        stderr_q,
        exit_q,
        total_duration,
        start_time,
        last_summary_time,
        summary_interval,
        last_progress,
    ) -> None:
        while True:
            # Check if process exited
            if not exit_q.empty():
                # Drain any remaining stderr lines so the final ffmpeg
                # progress line (frame/time/speed) is captured before we
                # break. On fast remuxes this line often arrives right at
                # process exit — skipping it would lose the 100% summary.
                while not stderr_q.empty():
                    event: ProcessOutput = stderr_q.get_nowait()
                    line = event.line or ""
                    progress_match = self._FFMPEG_PROGRESS_RE.search(line)
                    if progress_match:
                        current_time = self._parse_ffmpeg_time(
                            progress_match.group("time")
                        )
                        speed = float(progress_match.group("speed"))
                        frame = int(progress_match.group("frame"))
                        last_progress = {
                            "time": current_time,
                            "speed": speed,
                            "frame": frame,
                            "line": line,
                        }
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
                now = datetime.now(timezone.utc)
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
        else:
            logger.warning(
                f"Session {self.session_id}: remux coordinator saw NO progress lines"
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
        elapsed = (datetime.now(timezone.utc) - start_time).total_seconds()
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

        # Persist the latest progress so the REST endpoint can serve it even
        # after the supervisor process (and its NATS bridge) is gone.
        await self._persist_recording_progress({
            "percent": round(pct, 1),
            "frame": frame,
            "current_time": current_time,
            "total_duration": total_duration,
            "speed": speed,
            "elapsed": elapsed,
            "eta_seconds": eta_seconds if speed > 0 else None,
        })

    async def _persist_recording_progress(self, progress: dict) -> None:
        """Best-effort write of the latest remux progress to the Session row."""
        try:
            from mirrorr.services.session_lifecycle import _get_db_factory
            from mirrorr.storage.models import Session

            async with _get_db_factory(self.settings) as db_factory:
                async with db_factory() as db:
                    session = await db.get(Session, self.session_id)
                    if session is not None:
                        session.recording_progress = progress
                        db.add(session)
                        await db.commit()
        except Exception as e:
            logger.warning(f"Failed to persist recording progress for session {self.session_id}: {e}")

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

    async def probe_duration(self, path: Path) -> float:
        ffprobe_bin = os.environ.get("FFPROBE_EXECUTABLE") or await asyncio.to_thread(shutil.which, "ffprobe")
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

    async def _create_recording_entry(self, dest: Path, mp4_name: str, capture: dict | None = None) -> int:
        """Create the recording DB entry. Returns the recording ID.

        ``capture`` is the one that produced the media when a session fell back —
        the entry names that source, not the profile the session was created for.
        """
        from mirrorr.services.session_lifecycle import _get_db_factory
        from mirrorr.storage.models import Recording
        from mirrorr.storage import crud
        from mirrorr.storage.enums import ResourceType
        from mirrorr.api.auth import subscribe_requester

        mp4_in_dest = dest / mp4_name
        stat = mp4_in_dest.stat()
        started_at = self.session.started_at or datetime.now(timezone.utc).replace(tzinfo=None)
        ended_at = datetime.now(timezone.utc).replace(tzinfo=None)
        duration_seconds = await self.probe_duration(mp4_in_dest)
        profile_name = (capture or {}).get("profile_name") or (
            self.session.profile.name if self.session.profile else ""
        )
        engine_name = (capture or {}).get("engine_name") or (
            self.session.engine.name if self.session.engine else ""
        )
        resolver_name = (capture or {}).get("resolver_name") or (
            self.session.profile.resolver.name if self.session.profile else self.session.resolver.name
        )

        async with _get_db_factory(self.settings) as db_factory:
            async with db_factory() as db:
                recording = Recording(
                    user_friendly_name=profile_name or f"Session #{self.session.id}",
                    snake_case_name=dest.name,
                    disk_path=str(dest),
                    content_url=f"{self.settings.web_url}/content/recordings/{dest.name}/{mp4_name}",
                    profile_name=profile_name,
                    engine_name=engine_name,
                    resolver_name=resolver_name,
                    session_id=self.session.id,
                    started_at=started_at,
                    ended_at=ended_at,
                    duration_seconds=duration_seconds,
                    size_bytes=stat.st_size,
                    requester_user_token=self.session.requester_user_token,
                    requester_group_id=self.session.requester_group_id,
                )
                recording = await crud.create(db, recording)
                await subscribe_requester(
                    db, self.session.requester_user_token,
                    ResourceType.RECORDING, recording.id,
                )
                await db.commit()
                recording_id = recording.id

        return recording_id
