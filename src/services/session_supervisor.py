from __future__ import annotations

import argparse
import asyncio
import json
from multiprocessing.synchronize import Event as ShutdownEvent
import os
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from loguru import logger
from sqlmodel import select
from sqlalchemy.orm import selectinload

from src.storage.models import (
    EngineInterface,
    EngineContext,
    ResolverInterface,
    ResolverContext,
    Session,
    SessionStatus,
    Recording,
    Profile,
)
from src.services.process_bus import ProcessBus, EngineDone, EngineCrashed
from src.services.managed_process import ManagedProcess
from src.startup.config import MirrorrSettings
from nats.aio.client import Client as NATS


class SessionSupervisor:
    """Orchestrates a single session's lifecycle.

    Creates a ProcessBus, delegates process management to the engine,
    and acts as the upper-layer state machine that publishes standardized
    NATS events to the outside world.

    Also listens on a NATS control channel for commands (stop, restart)
    and forwards telemetry to NATS for WebSocket clients.
    """

    def __init__(
        self,
        session_id: int,
        session: Session,
        engine_interface: EngineInterface,
        resolver_interface: ResolverInterface,
        settings: MirrorrSettings,
    ) -> None:
        self.session_id = session_id
        self.session = session
        self.engine = engine_interface
        self.resolver = resolver_interface
        self.settings = settings

        self.bus = ProcessBus()
        self.processes: list[ManagedProcess] = []
        self._nc: NATS | None = None
        self.engine_ctx: EngineContext | None = None
        self.resolver_ctx: ResolverContext | None = None
        self._control_sub = None
        self._stash_task: asyncio.Task | None = None
        self._telemetry_tasks: list[asyncio.Task] = []

        # Resolve session folder
        if self.session.is_autorun:
            self.session_folder = settings.autoruns_dir / self.session.autorun.snake_case_name
        else:
            base = settings.content_dir / self.session.profile.name
            if base.exists():
                candidate = base
                i = 2
                while candidate.exists():
                    candidate = base.parent / f"{base.name}_{i}"
                    i += 1
                base = candidate
            self.session_folder = base

        self.session_folder = self.session_folder.resolve()
        self.logs_folder = self.session_folder / "logs"
        self.segments_folder = self.session_folder / "segments"
        self._stash_folder: Path = self.session_folder / "stash"
        self._stash_seen: set[str] = set()  # segment filenames already stashed

    # ── public ────────────────────────────────────────────────────────

    async def run(self) -> None:
        """Run the session to completion."""
        self._make_dirs()

        self.engine_ctx = EngineContext(
            bus=self.bus,
            session_folder=self.session_folder,
            logs_folder=self.logs_folder,
            segments_folder=self.segments_folder,
            hls_window=self.settings.hls_window,
            segment_duration=self.settings.segment_duration,
        )
        self.resolver_ctx = ResolverContext(
            bus=self.bus,
            session_folder=self.session_folder,
        )

        await self._update_status(SessionStatus.ACTIVE, set_started=True)
        await self._persist_session_urls()

        # 1. Resolve source via resolver
        try:
            from src.startup.ensure_resolvers import get_validated_config
            config = get_validated_config(
                resolvers_dir=self.settings.resolvers_dir,
                origin=self.session.profile.resolver.origin,
                expected_hash=self.session.profile.resolver.origin_hash,
                data=self.session.profile.resolver_config,
            )
            source = await self.resolver.resolve(config, self.resolver_ctx)
        except Exception as e:
            logger.error(f"Failed to resolve source: {e}")
            await self._update_status(SessionStatus.FAILED)
            await self._delete_self()
            return

        # 2. Start engine
        try:
            self.processes = await self.engine.start(self.engine_ctx, source)
        except Exception as e:
            logger.error(f"Failed to start engine: {e}")
            await self.bus.emit("engine.crashed", EngineCrashed(reason=str(e)))
            await self._update_status(SessionStatus.FAILED)
            await self._delete_self()
            return

        for proc in self.processes:
            await proc.start()
            proc.close_pipes()

        logger.success(f"Session {self.session_id} bootstrapped — "
                       f"{len(self.processes)} processes running")

        # 3. NATS bridge + recording stash
        await self._start_nats_bridge()
        if self.session.recording:
            self._start_stash_task()

        # 4. Wait for engine lifecycle signal or stop command
        done_q = self.bus.subscribe("engine.done")
        crash_q = self.bus.subscribe("engine.crashed")
        stop_q = self.bus.subscribe("session.stop_requested")

        done_task = asyncio.create_task(done_q.get())
        crash_task = asyncio.create_task(crash_q.get())
        stop_task = asyncio.create_task(stop_q.get())

        finished, _ = await asyncio.wait(
            [done_task, crash_task, stop_task],
            return_when=asyncio.FIRST_COMPLETED,
        )

        for t in [done_task, crash_task, stop_task]:
            if not t.done():
                t.cancel()
                try:
                    await t
                except asyncio.CancelledError:
                    pass

        # 5. Determine outcome
        result = finished.pop().result()
        if isinstance(result, EngineCrashed):
            logger.error(f"Session {self.session_id} crashed: {result.reason}")
            await self._cleanup()
            await self._update_status(SessionStatus.FAILED)
        elif isinstance(result, EngineDone):
            logger.success(f"Session {self.session_id} completed: {result.reason}")
            await self._finalize_session()
        else:
            logger.info(f"Session {self.session_id}: stop requested")
            await self._finalize_session()

    # ── recording / remux ────────────────────────────────────────────

    def _start_stash_task(self) -> None:
        """Start background task that copies oldest segments to stash
        before ffmpeg's delete_segments flag removes them."""
        self._segment_count = self.settings.hls_window // self.settings.segment_duration
        self._stash_batch = max(1, int(0.10 * self._segment_count))
        self._stash_folder.mkdir(exist_ok=True)
        self._stash_seen.clear()
        self._stash_task = asyncio.create_task(self._stash_loop())
        logger.info(f"Session {self.session_id}: recording stash task started "
                     f"(batch={self._stash_batch}, window={self._segment_count} segments)")

    async def _stash_loop(self) -> None:
        """Periodically copy the oldest N segments to the stash folder."""
        interval = self.settings.segment_duration * self._stash_batch
        try:
            while True:
                await asyncio.sleep(interval)
                await self._stash_batch_copy()
        except asyncio.CancelledError:
            await self._stash_batch_copy()

    async def _stash_batch_copy(self) -> None:
        segments = sorted(self.segments_folder.glob("*.ts"))
        batch = segments[:self._stash_batch]
        for seg in batch:
            name = seg.name
            if name not in self._stash_seen:
                dest = self._stash_folder / name
                if not dest.exists():
                    try:
                        shutil.copy2(seg, dest)
                    except FileNotFoundError:
                        logger.debug(f"Segment {name} deleted before stash, skipping")
                self._stash_seen.add(name)

    async def _finalize_session(self) -> None:
        """Cleanup processes, then remux and create Recording if applicable."""
        await self._cleanup()

        if not self.session.recording:
            await self._update_status(SessionStatus.COMPLETED)
            await self._delete_self()
            return

        await self._update_status(SessionStatus.REMUXING)
        try:
            recording = await self._remux_and_finalize()
            logger.success(f"Session {self.session_id}: recording created at {recording.disk_path}")
            await self._update_status(SessionStatus.COMPLETED)
            await self._delete_self()
        except Exception as e:
            logger.error(f"Session {self.session_id}: remux failed: {e}")
            await self._update_status(SessionStatus.FAILED)
            await self._delete_self()

    async def _remux_and_finalize(self) -> Recording:
        """Concatenate stash + segments into MP4, move to recordings, create DB entry."""
        # 1. Gather segments: stash first (chronological), then remaining live segments
        stash_segments = sorted(self._stash_folder.glob("*.ts")) if self._stash_folder and self._stash_folder.exists() else []
        live_segments = sorted(self.segments_folder.glob("*.ts"))

        # Deduplicate: live segments that are already in stash (by filename)
        stash_names = {s.name for s in stash_segments}
        live_only = [s for s in live_segments if s.name not in stash_names]

        ordered_segments = stash_segments + live_only
        if not ordered_segments:
            raise RuntimeError("No segments found to remux")

        logger.info(f"Session {self.session_id}: remuxing {len(ordered_segments)} segments "
                     f"({len(stash_segments)} from stash + {len(live_only)} from live)")

        # 2. Write concat list
        concat_list = self.session_folder / "concat.txt"
        with open(concat_list, "w") as f:
            for seg in ordered_segments:
                f.write(f"file '{seg.resolve()}'\n")

        # 3. Concat to MP4 — name it after the session folder, log progress
        mp4_name = self.session_folder.name + ".mp4"
        mp4_path = self.session_folder / mp4_name
        ffmpeg_bin = os.environ.get("FFMPEG_EXECUTABLE") or shutil.which("ffmpeg")
        if not ffmpeg_bin:
            raise RuntimeError("ffmpeg not found")

        logger.info(f"Session {self.session_id}: starting remux ({len(ordered_segments)} segments)")

        proc = await asyncio.create_subprocess_exec(
            ffmpeg_bin,
            "-hide_banner", "-loglevel", "info",
            "-stats",
            "-f", "concat", "-safe", "0",
            "-i", str(concat_list),
            "-c", "copy",
            str(mp4_path),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )

        # Read stderr line by line to log ffmpeg progress
        total = len(ordered_segments)
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

        logger.success(f"Session {self.session_id}: remux complete — {total} segments → {mp4_name}")

        # 4. Move session folder to recordings dir
        recordings_dir = self.settings.recordings_dir
        recordings_dir.mkdir(parents=True, exist_ok=True)
        dest = recordings_dir / self.session_folder.name
        if dest.exists():
            i = 2
            while dest.exists():
                dest = recordings_dir / f"{self.session_folder.name}_{i}"
                i += 1

        # Clean up temporary files before moving
        concat_list.unlink(missing_ok=True)
        stream_m3u8 = self.session_folder / "stream.m3u8"
        stream_m3u8.unlink(missing_ok=True)
        if self._stash_folder and self._stash_folder.exists():
            shutil.rmtree(self._stash_folder)
        for seg in self.segments_folder.iterdir():
            seg.unlink()
        self.segments_folder.rmdir()

        shutil.move(str(self.session_folder), str(dest))
        logger.info(f"Session {self.session_id}: moved to {dest}")

        # 5. Compute recording metadata
        mp4_in_dest = dest / mp4_name
        stat = mp4_in_dest.stat()
        size_bytes = stat.st_size
        started_at = self.session.started_at or datetime.now()
        ended_at = datetime.now()
        duration_seconds = await self._probe_duration(mp4_in_dest)

        # 6. Create Recording DB entry
        from src.storage.database import create_db_engine
        from src.storage import crud

        db_engine, session_factory = create_db_engine(self.settings)
        try:
            async with session_factory() as db_session:
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
                    size_bytes=size_bytes,
                )
                recording = await crud.create(db_session, recording)
        finally:
            await db_engine.dispose()

        return recording

    # ── helpers ──────────────────────────────────────────────────────

    async def _probe_duration(self, path: Path) -> float:
        """Get actual video duration via ffprobe."""
        ffprobe_bin = os.environ.get("FFPROBE_EXECUTABLE") or shutil.which("ffprobe")
        if not ffprobe_bin:
            logger.warning("ffprobe not found — falling back to wall-clock duration")
            return 0.0

        proc = await asyncio.create_subprocess_exec(
            ffprobe_bin,
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            str(path),
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

    # ── control channel ──────────────────────────────────────────────

    async def _handle_control(self, command: str) -> None:
        """Handle commands received on the NATS control channel."""
        if command == "stop":
            logger.info(f"Session {self.session_id}: received stop command")
            await self.bus.emit("session.stop_requested")
        elif command == "enable_recording":
            if not self.session.recording:
                self.session.recording = True
                self._start_stash_task()
                await self._update_recording_flag(True)
                logger.info(f"Session {self.session_id}: recording enabled mid-run")
        elif command == "disable_recording":
            if self.session.recording:
                self.session.recording = False
                if self._stash_task and not self._stash_task.done():
                    self._stash_task.cancel()
                await self._update_recording_flag(False)
                logger.info(f"Session {self.session_id}: recording disabled mid-run")

    async def _update_recording_flag(self, value: bool) -> None:
        from src.storage.database import create_db_engine
        from src.storage import crud

        db_engine, session_factory = create_db_engine(self.settings)
        try:
            async with session_factory() as db_session:
                session = await crud.get_by_id(db_session, Session, self.session_id)
                if session:
                    session.recording = value
                    await crud.update(db_session, Session, self.session_id, session)
        except Exception as e:
            logger.error(f"Failed to update recording flag: {e}")
        finally:
            await db_engine.dispose()

    async def _delete_self(self) -> None:
        """Delete the session DB row and folder, then emit SESSION_DELETED."""
        from src.storage.database import create_db_engine
        from src.storage import crud

        db_engine, session_factory = create_db_engine(self.settings)
        try:
            async with session_factory() as db:
                await crud.delete(db, Session, self.session_id)
        except Exception as e:
            logger.error(f"Failed to delete session {self.session_id}: {e}")
        finally:
            await db_engine.dispose()

        if self.session_folder.exists():
            shutil.rmtree(self.session_folder, ignore_errors=True)
            logger.info(f"Session {self.session_id}: folder deleted")

    # ── internal ──────────────────────────────────────────────────────

    async def _start_nats_bridge(self) -> None:
        """Connect a NATS client that listens for control commands
        and forwards telemetry to NATS for WebSocket clients."""
        try:
            self._nc = NATS()
            await self._nc.connect(self.settings.nats_url)

            control_subject = f"session.{self.session_id}.control"

            async def on_control(msg):
                try:
                    data = json.loads(msg.data.decode())
                    command = data.get("command")
                    if not command:
                        if msg.reply:
                            await msg.respond(json.dumps({"error": "missing command"}).encode())
                        return

                    if command in ("stop", "enable_recording", "disable_recording"):
                        await self._handle_control(command)
                        if msg.reply:
                            await msg.respond(json.dumps({"ok": True, "command": command}).encode())
                    else:
                        if msg.reply:
                            await msg.respond(json.dumps({"error": f"unknown command: {command}"}).encode())
                except Exception as e:
                    if msg.reply:
                        try:
                            await msg.respond(json.dumps({"error": str(e)}).encode())
                        except Exception:
                            pass

            self._control_sub = await self._nc.subscribe(control_subject, cb=on_control)

            for proc in self.processes:
                telemetry_q = self.bus.subscribe(f"proc.{proc.name}.telemetry")
                proc_name = proc.name

                async def _forward_telemetry(q, pname):
                    while True:
                        data = await q.get()
                        subject = f"session.{self.session_id}.telemetry.{pname}"
                        try:
                            if self._nc is None:
                                raise RuntimeError("NATS client is not connected")
                            await self._nc.publish(subject, json.dumps(data).encode())
                        except Exception:
                            return

                self._telemetry_tasks.append(asyncio.create_task(_forward_telemetry(telemetry_q, proc_name)))

            logger.info(f"Session {self.session_id}: NATS control channel active")
        except Exception as e:
            logger.error(f"Failed to setup NATS bridge: {e}")

    def _make_dirs(self) -> None:
        self.session_folder.mkdir(parents=True, exist_ok=True)
        self.logs_folder.mkdir(parents=True, exist_ok=True)
        self.segments_folder.mkdir(parents=True, exist_ok=True)
        self._copy_static_assets()
        self._build_session_urls()

    def _copy_static_assets(self) -> None:
        """Copy player/vlc/outplayer HTML into the session folder."""
        from src.startup.config import _PACKAGE_ROOT
        static_dir = _PACKAGE_ROOT / "static_files"
        if not static_dir.exists():
            return
        for f in static_dir.glob("*.html"):
            shutil.copy2(f, self.session_folder / f.name)

    def _build_session_urls(self) -> None:
        """Build session_urls with label->URL pairs for the session folder,
        static HTML files, and the HLS playlist."""
        web_url = self.settings.web_url.rstrip("/")
        if not web_url:
            return

        # Relative path from content_dir to session_folder
        try:
            rel = self.session_folder.relative_to(self.settings.content_dir)
        except ValueError:
            return

        base = f"{web_url}/content/{rel.as_posix()}"

        urls: list[dict[str, str]] = [
            {"label": "Session", "url": base + "/"},
        ]

        # Static HTML files with human-friendly labels
        label_map = {
            "player.html": "HTML",
            "vlc.html": "VLC",
            "outplayer.html": "Outplayer",
        }
        for f in sorted(self.session_folder.glob("*.html")):
            label = label_map.get(f.name, f.stem)
            urls.append({"label": label, "url": f"{base}/{f.name}"})

        # HLS playlist
        urls.append({"label": "M3U8", "url": f"{base}/stream.m3u8"})

        self.session.session_urls = urls

    async def _persist_session_urls(self) -> None:
        """Save session_urls to the database."""
        from src.storage.database import create_db_engine
        from src.storage import crud

        if not self.session.session_urls:
            return

        db_engine, session_factory = create_db_engine(self.settings)
        try:
            async with session_factory() as db_session:
                session = await crud.get_by_id(db_session, Session, self.session_id)
                if session:
                    session.session_urls = self.session.session_urls
                    await crud.update(db_session, Session, self.session_id, session)
        except Exception as e:
            logger.error(f"Failed to persist session_urls: {e}")
        finally:
            await db_engine.dispose()

    async def _cleanup(self) -> None:
        """Gracefully stop engine + resolver, then terminate all processes."""
        if self._stash_task and not self._stash_task.done():
            self._stash_task.cancel()
            try:
                await self._stash_task
            except asyncio.CancelledError:
                pass

        # Cancel engine-spawned tasks (pipe wiring, coordination, etc.)
        if self.engine_ctx and self.engine_ctx._tasks:
            for t in self.engine_ctx._tasks:
                if not t.done():
                    t.cancel()
            await asyncio.gather(*self.engine_ctx._tasks, return_exceptions=True)
            self.engine_ctx._tasks.clear()

        if self.engine_ctx:
            await self.engine.stop(self.engine_ctx)
        if self.resolver_ctx:
            self.resolver.stop(self.resolver_ctx)

        for proc in self.processes:
            if proc.running:
                await proc.terminate()

        # Wait concurrently for all processes to exit after SIGTERM
        running_procs = [p for p in self.processes if p.running]
        if running_procs:
            try:
                await asyncio.wait(
                    [asyncio.create_task(p._process.wait()) for p in running_procs if p._process is not None],
                    timeout=10.0,
                )
            except Exception:
                pass

        for proc in self.processes:
            if proc.running:
                logger.warning(f"Force-killing [{proc.name}]")
                await proc.kill()

        logger.info(f"Session {self.session_id}: all processes terminated")

        # Wait for internal reader/telemetry tasks to finish so pipe transports are clean
        for proc in self.processes:
            await proc.close()

        if self._nc:
            # Cancel telemetry forwarding tasks before disconnecting NATS
            if self._telemetry_tasks:
                for t in self._telemetry_tasks:
                    if not t.done():
                        t.cancel()
                await asyncio.gather(*self._telemetry_tasks, return_exceptions=True)
                self._telemetry_tasks.clear()

            if self._control_sub:
                try:
                    await self._control_sub.unsubscribe()
                except Exception:
                    pass
                self._control_sub = None
            try:
                await self._nc.drain()
            except Exception:
                pass
            self._nc = None

    async def _update_status(self, status: SessionStatus, set_started: bool = False) -> None:
        """Update the session status in the database and emit a NATS event."""
        from src.storage.database import create_db_engine
        from src.storage import crud
        from src.event_bus.event import MirrorrEvent

        db_engine, session_factory = create_db_engine(self.settings)
        try:
            async with session_factory() as db_session:
                session = await crud.get_by_id(db_session, Session, self.session_id)
                if session:
                    session.status = status
                    if set_started:
                        session.started_at = datetime.now()
                    if status in (SessionStatus.COMPLETED, SessionStatus.FAILED):
                        session.ended_at = datetime.now()
                    await crud.update(db_session, Session, self.session_id, session)
        except Exception as e:
            logger.error(f"Failed to update session status: {e}")
        finally:
            await db_engine.dispose()

        if self._nc is None:
            return

        try:
            subject_map = {
                (SessionStatus.ACTIVE, True): MirrorrEvent.SESSION_STARTED,
                SessionStatus.COMPLETED: MirrorrEvent.SESSION_STOPPED,
                SessionStatus.FAILED: MirrorrEvent.SESSION_CRASHED,
            }
            key = (status, set_started) if set_started else status
            event_cls = subject_map.get(key)
            if event_cls:
                await self._nc.publish(
                    event_cls.subject,
                    event_cls(id=self.session_id).model_dump_json().encode(),
                )
        except Exception as e:
            logger.error(f"Failed to emit NATS event for session {self.session_id}: {e}")

    @classmethod
    async def create(cls, session_id: int, settings: MirrorrSettings) -> SessionSupervisor:
        """Load the session from DB, JIT-load plugins, return a ready supervisor."""
        from src.storage.database import create_db_engine
        from src.storage import crud
        from src.startup.ensure_engines import load_engine_jit
        from src.startup.ensure_resolvers import load_resolver_jit

        engine, session_factory = create_db_engine(settings)
        try:
            async with session_factory() as db_session:
                stmt = (
                    select(Session)
                    .where(Session.id == session_id)
                    .options(
                        selectinload(Session.engine),  # ty:ignore
                        selectinload(Session.profile).selectinload(Profile.resolver),  # ty:ignore
                        selectinload(Session.autorun),  # ty:ignore
                    )
                )
                result = await db_session.exec(stmt)
                session: Session | None = result.one_or_none()

                if session is None:
                    raise ValueError(f"Session with id {session_id} not found")
                if not session.profile:
                    raise ValueError("Session missing profile")

                engine_interface = load_engine_jit(
                    settings.engines_dir,
                    session.engine.origin,
                    session.engine.origin_hash,
                )
                resolver_interface = load_resolver_jit(
                    settings.resolvers_dir,
                    session.profile.resolver.origin,
                    session.profile.resolver.origin_hash,
                )
        finally:
            await engine.dispose()

        return cls(session_id, session, engine_interface, resolver_interface, settings)


# ── Entry point for multiprocessing ───────────────────────────────────

async def runner(session_id: int, settings: MirrorrSettings, shutdown_event: ShutdownEvent | None = None) -> None:
    from src.startup.logging import setup_logging
    setup_logging()

    try:
        logger.info(f"Starting session supervisor for session {session_id}")
        supervisor = await SessionSupervisor.create(session_id, settings)
        logger.success(f"Supervisor created for session {session_id}")

        # Monitor the cross-platform shutdown event and emit a stop into the ProcessBus
        async def _watch_shutdown():
            while True:
                if shutdown_event and shutdown_event.is_set():
                    logger.info(f"Session {session_id}: shutdown event received")
                    await supervisor.bus.emit("session.stop_requested")
                    return
                await asyncio.sleep(0.5)

        if shutdown_event:
            asyncio.create_task(_watch_shutdown())

        await supervisor.run()
    except ValueError as e:
        logger.error(e)
        raise
    except Exception as e:
        logger.error(f"Session {session_id} failed with exception: {e}")
        raise


def main(session_id: int, settings: MirrorrSettings, shutdown_event: ShutdownEvent | None = None) -> None:
    # On Windows, ignore Ctrl+C in child processes — the parent controls
    # shutdown via the multiprocessing.Event. Without this, CTRL_C_EVENT
    # raises KeyboardInterrupt inside asyncio.run() and tears down the
    # event loop before cleanup can run, leaking pipe transports.
    if sys.platform == "win32" and shutdown_event is not None:
        import signal as _signal
        _signal.signal(_signal.SIGINT, _signal.SIG_IGN)

    try:
        asyncio.run(runner(session_id, settings, shutdown_event))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--session-id", type=int, required=True)
    args = parser.parse_args()
    settings = MirrorrSettings.create_from_env(".env")
    main(args.session_id, settings)
