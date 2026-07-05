from __future__ import annotations

import asyncio
import json
from datetime import datetime
from typing import Any

from loguru import logger

from src.plugins.interfaces import (
    EngineInterface,
    EngineContext,
    ResolverInterface,
    ResolverContext,
)
from src.storage.enums import SessionStatus
from src.storage.models import Autorun, Resolver, Session
from src.services.process_bus import ProcessBus, EngineDone, EngineCrashed
from src.services.managed_process import ManagedProcess
from src.services.recording import RecordingManager
from src.services.session_lifecycle import update_session, delete_session
from src.services.session_helpers import make_session_dirs, build_session_urls, load_session_from_db
from src.startup.config import MirrorrSettings
from src.event_bus.event import MirrorrEvent
from nats.aio.client import Client as NATS


# ═══════════════════════════════════════════════════════════════════════
# SessionSupervisor class
# ═══════════════════════════════════════════════════════════════════════


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
            profile_name = self.session.profile.name if self.session.profile else f"session-{self.session.id}"
            base = settings.content_dir / profile_name
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
                bus=self.bus,
                logs_folder=self.logs_folder,
                nc=self._nc,
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
                attempt_started_at = datetime.utcnow()
                logger.opt(colors=True).info(
                    f"starting attempt <yellow>{attempt}</yellow>"
                    f" (retry_mode={retry_config['mode']})"
                )

                # Emit the attempt record immediately so the UI shows it
                # as running.  We update it after the attempt finishes.
                attempt_record: dict[str, Any] = {
                    "index": attempt,
                    "started_at": attempt_started_at.isoformat(),
                    "ended_at": None,
                    "duration_seconds": None,
                    "returncode": None,
                    "reason": None,
                }
                self.session.attempts = (self.session.attempts or []) + [attempt_record]
                await update_session(
                    self.settings, self.session_id,
                    retry_attempts=attempt,
                    attempts=self.session.attempts,
                    nc=self._nc,
                )

                outcome, signal = await self._run_attempt()

                # Finalize the attempt record in-place
                attempt_ended_at = datetime.utcnow()
                attempt_duration = (attempt_ended_at - attempt_started_at).total_seconds()
                attempt_record["ended_at"] = attempt_ended_at.isoformat()
                attempt_record["duration_seconds"] = round(attempt_duration, 2)
                attempt_record["returncode"] = getattr(signal, "returncode", None) if signal else None
                attempt_record["reason"] = getattr(signal, "reason", None) if signal else ("stopped" if outcome == "stopped" else None)

                await update_session(
                    self.settings, self.session_id,
                    attempts=self.session.attempts,
                    nc=self._nc,
                )

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
                    await update_session(self.settings, self.session_id, status=SessionStatus.FAILED, nc=self._nc)
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
        make_session_dirs(self.session_folder, self.logs_folder, self.segments_folder, self.settings)

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

        await update_session(
            self.settings, self.session_id,
            status=SessionStatus.RECORDING if self.session.recording else SessionStatus.ACTIVE,
            session_urls=build_session_urls(self.session_folder, self.segments_folder, self.settings),
            nc=self._nc,
        )

        # 2. Resolve source via resolver
        try:
            from src.startup.ensure_resolvers import get_validated_config
            from src.storage.database import create_db_engine

            _eng, _sf = create_db_engine(self.settings)
            try:
                async with _sf() as _db:
                    resolver_model = await _db.get(Resolver, self.session.resolver_id)
            finally:
                await _eng.dispose()

            config = get_validated_config(
                resolvers_dir=self.settings.resolvers_dir,
                origin=resolver_model.origin,
                expected_hash=resolver_model.origin_hash,
                data=self.session.resolver_config,
            )
            source = await self.resolver.resolve(config, self.resolver_ctx)
        except Exception as e:
            logger.error(f"Failed to resolve source: {e}")
            await update_session(self.settings, self.session_id, status=SessionStatus.FAILED, nc=self._nc)
            await delete_session(
                self.settings, self.session_id, self.session_folder,
                nc=self._nc, autorun_id=self.session.autorun_id,
            )
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
            await update_session(self.settings, self.session_id, status=SessionStatus.COMPLETED, nc=self._nc)
            await delete_session(
                self.settings, self.session_id, self.session_folder,
                nc=self._nc, autorun_id=self.session.autorun_id,
            )
            return

        await update_session(self.settings, self.session_id, status=SessionStatus.REMUXING, nc=self._nc)
        try:
            recording_id = await self._recording.remux()
            logger.success(f"recording created")
            await update_session(self.settings, self.session_id, status=SessionStatus.FINALIZING, nc=self._nc)
            await update_session(self.settings, self.session_id, status=SessionStatus.COMPLETED, nc=self._nc)
            await delete_session(
                self.settings, self.session_id,
                nc=self._nc, autorun_id=self.session.autorun_id,
            )
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
            await update_session(self.settings, self.session_id, status=SessionStatus.FAILED, nc=self._nc)
            await delete_session(
                self.settings, self.session_id, self.session_folder,
                nc=self._nc, autorun_id=self.session.autorun_id,
            )

    # ── control channel ──────────────────────────────────────────────

    async def _handle_control(self, command: str) -> None:
        """Handle commands received on the NATS control channel."""
        if command == "stop":
            logger.info(f"received stop command")
            await update_session(self.settings, self.session_id, status=SessionStatus.TERMINATING, nc=self._nc)
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
                    bus=self.bus,
                    logs_folder=self.logs_folder,
                    nc=self._nc,
                )
                self._recording.start_stash()
                await update_session(self.settings, self.session_id, recording=True, status=SessionStatus.RECORDING, nc=self._nc)
                logger.info(f"recording enabled mid-run")
        elif command == "disable_recording":
            if self.session.recording:
                self.session.recording = False
                if self._recording:
                    await self._recording.stop_stash()
                    self._recording = None
                await update_session(self.settings, self.session_id, recording=False, status=SessionStatus.ACTIVE, nc=self._nc)
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

            # Propagate NATS connection to recording manager
            if self._recording:
                self._recording.nc = self._nc
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


# ── Backward-compatible re-exports ───────────────────────────────────
# runner() and main() now live in session_runner.py.
# Import from there for new code.
from src.services.session_runner import runner, main  # noqa: F401, E402
