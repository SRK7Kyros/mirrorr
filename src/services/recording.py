"""Recording lifecycle: stash segments during streaming, remux on finalize."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING

from loguru import logger

if TYPE_CHECKING:
    from src.storage.models import Session
    from src.startup.config import MirrorrSettings


@dataclass
class RecordingManager:
    """Handles segment stashing and remux-to-MP4 for recorded sessions.

    Composed into SessionSupervisor. Owns the stash task and remux logic.
    """

    session_id: int
    session: Session
    settings: MirrorrSettings
    session_folder: Path
    stash_folder: Path
    segments_folder: Path

    # internal state
    _stash_task: asyncio.Task | None = field(default=None, init=False, repr=False)
    _stash_seen: set[str] = field(default_factory=set, init=False, repr=False)
    _segment_count: int = field(default=0, init=False, repr=False)
    _stash_batch: int = field(default=0, init=False, repr=False)

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
        """Concatenate stash + remaining segments into MP4, move to recordings,
        create Recording DB entry. Returns the recording ID."""
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

        # 2. Write concat list and run ffmpeg
        mp4_name = self.session_folder.name + ".mp4"
        mp4_path = self.session_folder / mp4_name
        concat_list = self.session_folder / "concat.txt"

        with open(concat_list, "w") as f:
            for seg in ordered:
                f.write(f"file '{seg.resolve()}'\n")

        ffmpeg_bin = os.environ.get("FFMPEG_EXECUTABLE") or shutil.which("ffmpeg")
        if not ffmpeg_bin:
            raise RuntimeError("ffmpeg not found")

        proc = await asyncio.create_subprocess_exec(
            ffmpeg_bin,
            "-hide_banner", "-loglevel", "info", "-stats",
            "-f", "concat", "-safe", "0", "-i", str(concat_list),
            "-c", "copy", str(mp4_path),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )

        assert proc.stderr is not None
        while True:
            line = await proc.stderr.readline()
            if not line:
                break
            text = line.decode("utf-8", errors="replace").strip()
            if text:
                logger.debug(f"Session {self.session_id}: remux: {text}")

        await proc.wait()
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg concat failed (code {proc.returncode})")

        logger.success(
            f"Session {self.session_id}: remux complete — {len(ordered)} segments → {mp4_name}"
        )

        # 3. Move to recordings dir
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

        # 4. Create Recording DB entry
        recording_id = await self._create_recording_entry(dest, mp4_name)
        return recording_id

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
