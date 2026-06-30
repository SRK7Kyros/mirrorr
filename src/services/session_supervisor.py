from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime
from multiprocessing.synchronize import Event as ShutdownEvent
from pathlib import Path
from typing import Any

from loguru import logger
from sqlmodel import select
from sqlalchemy.orm import selectinload

from src.storage.models import (
    EngineInterface,
    EngineContext,
    ResolverInterface,
    ResolverContext,
    Autorun,
    AutorunStatus,
    Session,
    SessionStatus,
    Profile,
)
from src.services.process_bus import ProcessBus, EngineDone, EngineCrashed
from src.services.managed_process import ManagedProcess
from src.services.recording import RecordingManager
from src.startup.config import MirrorrSettings
from src.event_bus.event import MirrorrEvent
from nats.aio.client import Client as NATS




# ── Private helper functions ──────────────────────────────────────────

async def _update_session_status(
    settings: MirrorrSettings,
    session_id: int,
    status: SessionStatus,
    set_started: bool = False,
    nc: NATS | None = None,
) -> None:
    """Update the session status in the DB, propagate to autorun, and emit NATS events."""
    from src.storage.database import create_db_engine
    from src.storage import crud

    db_engine, session_factory = create_db_engine(settings)
    autorun_id: int | None = None
    try:
        async with session_factory() as db_session:
            session = await crud.get_by_id(db_session, Session, session_id)
            if session:
                session.status = status
                if set_started:
                    session.started_at = datetime.utcnow()
                if status in (SessionStatus.COMPLETED, SessionStatus.FAILED):
                    session.ended_at = datetime.utcnow()
                await crud.update(db_session, Session, session_id, session)

                # Propagate to autorun — mirror the session status
                if session.autorun_id:
                    autorun = await crud.get_by_id(db_session, Autorun, session.autorun_id)
                    if autorun:
                        # Map session status to autorun status
                        status_map = {
                            SessionStatus.ACTIVE: AutorunStatus.ACTIVE,
                            SessionStatus.RECORDING: AutorunStatus.RECORDING,
                            SessionStatus.TERMINATING: AutorunStatus.TERMINATING,
                            SessionStatus.REMUXING: AutorunStatus.REMUXING,
                            SessionStatus.FINALIZING: AutorunStatus.FINALIZING,
                            SessionStatus.COMPLETED: AutorunStatus.COMPLETED,
                            SessionStatus.FAILED: AutorunStatus.FAILED,
                        }
                        autorun.status = status_map.get(status, AutorunStatus.ACTIVE)
                        await crud.update(db_session, Autorun, autorun.id, autorun)
                        autorun_id = autorun.id
    except Exception as e:
        logger.error(f"Failed to update session status: {e}")
    finally:
        await db_engine.dispose()

    if nc is None:
        return

    try:
        # Always emit SESSION_UPDATED so WS clients get every status change
        await nc.publish(
            MirrorrEvent.SESSION_UPDATED.subject,
            MirrorrEvent.SESSION_UPDATED(id=session_id).model_dump_json().encode(),
        )

        # Also emit AUTORUN_UPDATED if we propagated to an autorun
        if autorun_id:
            await nc.publish(
                MirrorrEvent.AUTORUN_UPDATED.subject,
                MirrorrEvent.AUTORUN_UPDATED(id=autorun_id).model_dump_json().encode(),
            )

        subject_map = {
            (SessionStatus.ACTIVE, True): MirrorrEvent.SESSION_STARTED,
            SessionStatus.COMPLETED: MirrorrEvent.SESSION_STOPPED,
            SessionStatus.FAILED: MirrorrEvent.SESSION_CRASHED,
        }
        key = (status, set_started) if set_started else status
        event_cls = subject_map.get(key)
        if event_cls:
            await nc.publish(
                event_cls.subject,
                event_cls(id=session_id).model_dump_json().encode(),
            )
    except Exception as e:
        logger.opt(colors=True).error(f"Failed to emit NATS event for session <green>{session_id}</green>: {e}")


async def _delete_session(settings: MirrorrSettings, session_id: int, session_folder: Path | None = None) -> None:
    """Delete the session DB row and folder, then emit SESSION_DELETED."""
    from src.storage.database import create_db_engine
    from src.storage import crud

    db_engine, session_factory = create_db_engine(settings)
    try:
        async with session_factory() as db:
            await crud.delete(db, Session, session_id)
    except Exception as e:
        logger.error(f"Failed to delete session {session_id}: {e}")
    finally:
        await db_engine.dispose()

    if session_folder and session_folder.exists():
        shutil.rmtree(session_folder, ignore_errors=True)


def _make_session_dirs(
    session_folder: Path,
    logs_folder: Path,
    segments_folder: Path,
    settings: MirrorrSettings,
) -> None:
    """Create session directories and copy static assets."""
    session_folder.mkdir(parents=True, exist_ok=True)
    logs_folder.mkdir(parents=True, exist_ok=True)
    segments_folder.mkdir(parents=True, exist_ok=True)
    _copy_static_assets(session_folder, settings)
    _build_session_urls(session_folder, segments_folder, settings)


def _copy_static_assets(session_folder: Path, settings: MirrorrSettings) -> None:
    """Copy player/vlc/outplayer HTML into the session folder."""
    from src.startup.config import _PACKAGE_ROOT
    static_dir = _PACKAGE_ROOT / "static_files"
    if not static_dir.exists():
        return
    for f in static_dir.glob("*.html"):
        shutil.copy2(f, session_folder / f.name)


def _build_session_urls(
    session_folder: Path,
    segments_folder: Path,
    settings: MirrorrSettings,
) -> list[dict[str, str]]:
    """Build session_urls with label->URL pairs for the session folder."""
    web_url = settings.web_url.rstrip("/")
    if not web_url:
        return []

    try:
        rel = session_folder.relative_to(settings.content_dir)
    except ValueError:
        return []

    base = f"{web_url}/content/{rel.as_posix()}"
    urls: list[dict[str, str]] = []

    if (session_folder / "player.html").exists():
        urls.append({"label": "HTML", "url": f"{base}/player.html?src=stream.m3u8"})

    urls.append({"label": "M3U8", "url": f"{base}/stream.m3u8"})

    if (session_folder / "outplayer.html").exists():
        urls.append({"label": "Outplayer", "url": f"{base}/outplayer.html?src=stream.m3u8"})

    if (session_folder / "vlc.html").exists():
        urls.append({"label": "VLC", "url": f"{base}/vlc.html?src=stream.m3u8"})

    urls.append({"label": "Session", "url": base + "/"})
    return urls


async def _persist_session_urls(
    settings: MirrorrSettings,
    session_id: int,
    session_urls: list[dict[str, str]],
) -> None:
    """Save session_urls to the database."""
    from src.storage.database import create_db_engine
    from src.storage import crud

    if not session_urls:
        return

    db_engine, session_factory = create_db_engine(settings)
    try:
        async with session_factory() as db_session:
            session = await crud.get_by_id(db_session, Session, session_id)
            if session:
                session.session_urls = session_urls
                await crud.update(db_session, Session, session_id, session)
    except Exception as e:
        logger.error(f"Failed to persist session_urls: {e}")
    finally:
        await db_engine.dispose()


async def _update_recording_flag(
    settings: MirrorrSettings,
    session_id: int,
    value: bool,
) -> None:
    """Update the recording flag in the database."""
    from src.storage.database import create_db_engine
    from src.storage import crud

    db_engine, session_factory = create_db_engine(settings)
    try:
        async with session_factory() as db_session:
            session = await crud.get_by_id(db_session, Session, session_id)
            if session:
                session.recording = value
                await crud.update(db_session, Session, session_id, session)
    except Exception as e:
        logger.error(f"Failed to update recording flag: {e}")
    finally:
        await db_engine.dispose()


async def _load_session_from_db(
    settings: MirrorrSettings,
    session_id: int,
) -> tuple[Session, EngineInterface, ResolverInterface]:
    """Load the session from DB, JIT-load plugins, return components."""
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
            return session, engine_interface, resolver_interface
    finally:
        await engine.dispose()


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
        self._recording: RecordingManager | None = None
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
        self._recording = (
            RecordingManager(
                session_id=self.session_id,
                session=self.session,
                settings=self.settings,
                session_folder=self.session_folder,
                stash_folder=self.session_folder / "stash",
                segments_folder=self.segments_folder,
            )
            if self.session.recording
            else None
        )

    # ── public ────────────────────────────────────────────────────────

    async def run(self) -> None:
        """Run the session to completion, with retry logic if configured."""
        retry_config = {
            "mode": self.session.effective_retry_mode(),
            "params": self.session.effective_retry_config(),
        }
        attempt = 0

        try:
            while True:
                attempt += 1
                self.session.retry_attempts = attempt
                logger.opt(colors=True).info(
                    f"starting attempt <yellow>{attempt}</yellow>"
                    f" (retry_mode={retry_config['mode']})"
                )

                outcome, signal = await self._run_attempt()

                if outcome == "stopped":
                    return

                # Check retry for both crashes and done signals
                if outcome == "crashed" and isinstance(signal, EngineCrashed):
                    retry, delay = await self.engine.should_retry(
                        crash=signal,
                        attempt=attempt,
                        config=retry_config,
                    )
                    if retry:
                        logger.opt(colors=True).info(
                            f"retrying in <yellow>{delay}s</yellow> after: {signal.reason}"
                        )
                        await self._cleanup(reason="retry")
                        await self._reset_for_retry()
                        if delay > 0:
                            await asyncio.sleep(delay)
                        continue
                    logger.opt(colors=True).error(
                        f"giving up after attempt <yellow>{attempt}</yellow>: {signal.reason}"
                    )
                    await self._cleanup(reason="failed")
                    await _update_session_status(self.settings, self.session_id, SessionStatus.FAILED, nc=self._nc)
                    return

                if outcome == "done" and signal is not None:
                    # Engine reported done — check if exit_code mode wants to retry
                    if signal.returncode is not None and retry_config["mode"] == "exit_code":
                        synthetic = EngineCrashed(
                            reason=f"completed with exit code {signal.returncode}",
                            returncode=signal.returncode,
                        )
                        retry, delay = await self.engine.should_retry(
                            crash=synthetic,
                            attempt=attempt,
                            config=retry_config,
                        )
                        if retry:
                            logger.opt(colors=True).info(
                                f"retrying in <yellow>{delay}s</yellow> after: {synthetic.reason}"
                            )
                            await self._cleanup(reason="retry")
                            await self._reset_for_retry()
                            if delay > 0:
                                await asyncio.sleep(delay)
                            continue

                    # No retry — finalize the session
                    await self._cleanup(reason="stop")
                    await self._finalize_session()
                    return

                # Should never reach here
                logger.error(f"Unexpected outcome: {outcome} — stopping")
                await self._cleanup(reason="stop")
                await self._finalize_session()
                return
        finally:
            # Always disconnect NATS last, after all status updates
            await self._disconnect_nats()

    async def _run_attempt(self) -> tuple[str, EngineCrashed | EngineDone | None]:
        """Single resolve→start→wait cycle. Returns (outcome, signal)."""
        _make_session_dirs(self.session_folder, self.logs_folder, self.segments_folder, self.settings)

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

        # 1. Connect NATS early so status updates emit WS events
        await self._connect_nats()

        await _update_session_status(
            self.settings, self.session_id,
            SessionStatus.RECORDING if self.session.recording else SessionStatus.ACTIVE,
            set_started=True, nc=self._nc,
        )
        await _persist_session_urls(self.settings, self.session_id, _build_session_urls(self.session_folder, self.segments_folder, self.settings))

        # 2. Resolve source via resolver
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
            await _update_session_status(self.settings, self.session_id, SessionStatus.FAILED, nc=self._nc)
            await _delete_session(self.settings, self.session_id, self.session_folder)
            return "stopped", None

        # 2. Start engine
        try:
            self.processes = await self.engine.start(self.engine_ctx, source)
        except Exception as e:
            logger.error(f"Failed to start engine: {e}")
            crash = EngineCrashed(reason=str(e))
            await self.bus.emit("engine.crashed", crash)
            return "crashed", crash

        for proc in self.processes:
            await proc.start()
            proc.close_pipes()

        logger.opt(colors=True).success(f"<green>Session</green> bootstrapped — "
                       f"{len(self.processes)} processes running")

        # 4. Wire telemetry + recording stash
        self._wire_telemetry()
        if self._recording:
            self._recording.start_stash()

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

        result = finished.pop().result()

        # If a stop was also pending alongside a crash/done, drain it
        # so we treat the outcome as a clean stop.
        stop_also_pending = not stop_task.done()
        if stop_also_pending:
            stop_task.cancel()
            try:
                await stop_task
            except asyncio.CancelledError:
                pass

        if isinstance(result, EngineDone):
            logger.opt(colors=True).success(f"<green>Session</green> completed: {result.reason}")
            return "done", result
        elif isinstance(result, EngineCrashed):
            if stop_also_pending:
                logger.info(f"stop requested (ignoring crash: {result.reason})")
                await self._cleanup(reason="stop")
                await self._finalize_session()
                return "stopped", None
            logger.opt(colors=True).error(f"<red>Session failed</red>: {result.reason}")
            return "crashed", result
        else:
            logger.info(f"stop requested")
            await self._cleanup(reason="stop")
            await self._finalize_session()
            return "stopped", None

    # ── recording / remux ────────────────────────────────────────────

    async def _finalize_session(self) -> None:
        """Cleanup processes, then remux and create Recording if applicable.

        Note: _cleanup() is called by the caller (run()), not here.
        NATS is disconnected at the very end of run().
        """

        if not self._recording:
            await _update_session_status(self.settings, self.session_id, SessionStatus.COMPLETED, nc=self._nc)
            await _delete_session(self.settings, self.session_id, self.session_folder)
            return

        await _update_session_status(self.settings, self.session_id, SessionStatus.REMUXING, nc=self._nc)
        try:
            recording_id = await self._recording.remux()
            logger.success(f"recording created")
            await _update_session_status(self.settings, self.session_id, SessionStatus.FINALIZING, nc=self._nc)
            await _update_session_status(self.settings, self.session_id, SessionStatus.COMPLETED, nc=self._nc)
            await _delete_session(self.settings, self.session_id)
            # Emit RECORDING_CREATED via our own NATS connection
            if recording_id and self._nc:
                try:
                    await self._nc.publish(
                        MirrorrEvent.RECORDING_CREATED.subject,
                        MirrorrEvent.RECORDING_CREATED(id=recording_id).model_dump_json().encode(),
                    )
                except Exception as e:
                    logger.error(f"Failed to emit RECORDING_CREATED: {e}")
        except Exception as e:
            logger.error(f"remux failed: {e}")
            await _update_session_status(self.settings, self.session_id, SessionStatus.FAILED, nc=self._nc)
            await _delete_session(self.settings, self.session_id, self.session_folder)

    # ── control channel ──────────────────────────────────────────────

    async def _handle_control(self, command: str) -> None:
        """Handle commands received on the NATS control channel."""
        if command == "stop":
            logger.info(f"received stop command")
            await _update_session_status(self.settings, self.session_id, SessionStatus.TERMINATING, nc=self._nc)
            await self.bus.emit("session.stop_requested")
        elif command == "enable_recording":
            if not self.session.recording:
                self.session.recording = True
                self._recording = RecordingManager(
                    session_id=self.session_id,
                    session=self.session,
                    settings=self.settings,
                    session_folder=self.session_folder,
                    stash_folder=self.session_folder / "stash",
                    segments_folder=self.segments_folder,
                )
                self._recording.start_stash()
                await _update_recording_flag(self.settings, self.session_id, True)
                await _update_session_status(self.settings, self.session_id, SessionStatus.RECORDING, nc=self._nc)
                logger.info(f"recording enabled mid-run")
        elif command == "disable_recording":
            if self.session.recording:
                self.session.recording = False
                if self._recording:
                    await self._recording.stop_stash()
                    self._recording = None
                await _update_recording_flag(self.settings, self.session_id, False)
                await _update_session_status(self.settings, self.session_id, SessionStatus.ACTIVE, nc=self._nc)
                logger.info(f"recording disabled mid-run")



    # ── internal ──────────────────────────────────────────────────────

    async def _connect_nats(self) -> None:
        """Connect NATS and subscribe to the control channel.

        Call this early — before any status update that needs to emit WS events.
        Idempotent: does nothing if already connected.
        """
        if self._nc and self._nc.is_connected:
            return
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
            logger.info(f"NATS control channel active")
        except Exception as e:
            logger.error(f"Failed to connect NATS: {e}")

    def _wire_telemetry(self) -> None:
        """Forward per-process telemetry to NATS. Call after processes start."""
        if not self._nc:
            return
        for proc in self.processes:
            telemetry_q = self.bus.subscribe(f"proc.{proc.name}.telemetry")
            proc_name = proc.name

            async def _forward_telemetry(q, pname):
                while True:
                    data = await q.get()
                    subject = f"session.{self.session_id}.telemetry.{pname}"
                    try:
                        await self._nc.publish(subject, json.dumps(data).encode())
                    except Exception:
                        return

            self._telemetry_tasks.append(asyncio.create_task(_forward_telemetry(telemetry_q, proc_name)))


    async def _cleanup(self, reason: str = "stop") -> None:
        """Gracefully stop engine + resolver, then terminate all processes.

        Does NOT disconnect NATS — call _disconnect_nats() after all
        status updates are sent.
        """
        if self._recording:
            await self._recording.stop_stash()

        # Cancel engine-spawned tasks (pipe wiring, coordination, etc.)
        if self.engine_ctx and self.engine_ctx._tasks:
            for t in self.engine_ctx._tasks:
                if not t.done():
                    t.cancel()
            await asyncio.gather(*self.engine_ctx._tasks, return_exceptions=True)
            self.engine_ctx._tasks.clear()

        if self.engine_ctx:
            await self.engine.stop(self.engine_ctx, reason=reason)
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
                logger.opt(colors=True).warning(f"Force-killing [<cyan>{proc.name}</cyan>]")
                await proc.kill()

        logger.info(f"all processes terminated")

        # Wait for internal reader/telemetry tasks to finish so pipe transports are clean
        for proc in self.processes:
            await proc.close()

    async def _reset_for_retry(self) -> None:
        """Tear down attempt-specific state before retrying.

        Cancels stale telemetry forwarding tasks, clears the ProcessBus
        so old queues don't bleed into the next attempt, and resets
        process/engine/resolver contexts.
        """
        # Cancel telemetry forwarding tasks from this attempt
        if self._telemetry_tasks:
            for t in self._telemetry_tasks:
                if not t.done():
                    t.cancel()
            await asyncio.gather(*self._telemetry_tasks, return_exceptions=True)
            self._telemetry_tasks.clear()

        # Wipe all subscriber queues — stale data from the previous attempt
        # must not leak into the next one
        self.bus.clear()

        self.processes.clear()
        self.engine_ctx = None
        self.resolver_ctx = None

    async def _disconnect_nats(self) -> None:
        """Disconnect NATS. Call LAST, after all status updates are sent."""
        if not self._nc:
            return

        # Cancel telemetry forwarding tasks
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


# ── Entry point for multiprocessing ───────────────────────────────────

async def runner(session_id: int, settings: MirrorrSettings, shutdown_event: ShutdownEvent | None = None) -> None:
    from src.startup.logging import setup_logging
    setup_logging()

    try:
        logger.opt(colors=True).info(f"Starting session supervisor for session <green>{session_id}</green>")
        session, engine_interface, resolver_interface = await _load_session_from_db(settings, session_id)
        supervisor = SessionSupervisor(session_id, session, engine_interface, resolver_interface, settings)
        logger.opt(colors=True).success(f"Supervisor created for session <green>{session_id}</green>")

        # Monitor the cross-platform shutdown event and emit a stop into the ProcessBus
        async def _watch_shutdown():
            while True:
                if shutdown_event and shutdown_event.is_set():
                    logger.info(f"Session {session_id}: shutdown event received")
                    await supervisor.bus.emit("session.stop_requested")
                    return
                await asyncio.sleep(0.1)

        if shutdown_event:
            asyncio.create_task(_watch_shutdown())

        await supervisor.run()
    except ValueError as e:
        logger.error(e)
        # Session not found or missing profile — mark FAILED
        await _update_session_status(settings, session_id, SessionStatus.FAILED)
        raise
    except Exception as e:
        logger.error(f"Session {session_id} failed with exception: {e}")
        await _update_session_status(settings, session_id, SessionStatus.FAILED)
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
