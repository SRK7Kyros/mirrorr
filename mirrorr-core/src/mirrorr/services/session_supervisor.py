from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone
from typing import Any

from loguru import logger

from mirrorr.plugin_api.interfaces import (
    EngineInterface,
    EngineContext,
    ResolverInterface,
    ResolverContext,
)
from mirrorr.storage.enums import SessionStatus
from mirrorr.storage.models import Session
from mirrorr.services.process_bus import ProcessBus, EngineDone, EngineCrashed
from mirrorr.services.managed_process import ManagedProcess
from mirrorr.services.recording import RecordingManager
from mirrorr.services.session_lifecycle import update_session, delete_session
from mirrorr.services.session_helpers import make_session_dirs, build_session_urls
from mirrorr.services.telemetry import (
    PUBLISH_INTERVAL_S as TELEMETRY_PUBLISH_INTERVAL_S,
    build_frame,
    record_sample,
)
from mirrorr.startup.config import MirrorrSettings
from mirrorr.event_bus.event import MirrorrEvent
from nats.aio.client import Client as NATS

_HEARTBEAT_INTERVAL = 60.0
STREAM_READY_POLL_S = 0.5
# A config that never resolves cannot resolve by retrying (a stale channel
# name): past this many failures in a row the attempt is terminal, so the row
# FAILS and an autorun's fallback chain can advance instead of looping forever.
_MAX_RESOLVE_FAILURES = 3


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
        # Latched stop request. Stateful on purpose: a stop that lands while
        # an attempt is still bootstrapping (resolve/engine start) must not be
        # lost the way a one-shot bus message is.
        self._stop = asyncio.Event()
        # True once the current attempt has published ACTIVE/RECORDING. The gate
        # owns the status, so a recording toggle must not move a pre-gate session.
        self._playable = False
        self.processes: list[ManagedProcess] = []
        self._nc: NATS | None = None
        self.engine_ctx: EngineContext | None = None
        self.resolver_ctx: ResolverContext | None = None
        self._control_sub = None
        self._recording: RecordingManager | None = None
        self._telemetry_tasks: list[asyncio.Task] = []
        self._resolve_failures = 0

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
        # A profile name is user-supplied and used as a path segment, so confine
        # the resolved folder to the managed roots — a name like "../../x" (or an
        # absolute path) must never place it outside the content/autoruns trees.
        roots = (settings.content_dir.resolve(), settings.autoruns_dir.resolve())
        if not any(self.session_folder == root or self.session_folder.is_relative_to(root) for root in roots):
            logger.warning(
                f"Session {self.session_id}: unsafe session folder "
                f"{self.session_folder} outside {roots}; using a per-session folder"
            )
            self.session_folder = roots[0] / f"session-{self.session_id}"
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

    def request_stop(self) -> None:
        """Latch a stop request; observed by the current or next attempt."""
        self._stop.set()

    async def run(self) -> None:
        """Run the session to completion, with retry logic if configured."""
        retry_config = {
            "mode": self.session.retry_mode,
            "params": self.session.retry_config,
        }
        attempt = 0
        heartbeat = asyncio.create_task(self._heartbeat())

        try:
            while True:
                attempt += 1
                self.session.retry_attempts = attempt
                attempt_started_at = datetime.now(timezone.utc).replace(tzinfo=None)
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
                attempt_ended_at = datetime.now(timezone.utc).replace(tzinfo=None)
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
                    # Session was user-stopped — finalize recording (if any) but keep the session in DB
                    await self._finalize_stopped()
                    return

                if outcome == "failed":
                    # Startup failure (pre-flight or process start) — the row was
                    # already marked FAILED in _run_attempt and kept, so the
                    # reason stays visible. Neither is retried.
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
            heartbeat.cancel()
            # Always disconnect NATS last, after all status updates
            await self._disconnect_nats()

    async def _heartbeat(self) -> None:
        """Log liveness so a silent supervisor is distinguishable from a dead one."""
        while True:
            await asyncio.sleep(_HEARTBEAT_INTERVAL)
            running = [proc.pid for proc in self.processes if proc.running]
            logger.info(
                f"Session {self.session_id}: heartbeat "
                f"(attempt {self.session.retry_attempts}, live pids={running})"
            )

    async def _run_attempt(self) -> tuple[str, EngineCrashed | EngineDone | None]:
        """Single resolve→smoke→start→ready cycle. Returns (outcome, signal)."""
        await make_session_dirs(self.session_folder, self.logs_folder, self.segments_folder, self.settings)

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
            companions_dir=self.settings.companions_dir,
        )

        # 1. Connect NATS early so status updates emit WS events
        await self._connect_nats()

        # A stop latched while bootstrapping must abort before we start
        # anything (the control channel only exists after _connect_nats).
        if self._stop.is_set():
            logger.info("stop requested before start — skipping attempt")
            return "stopped", None

        # 2. Publish the session as initializing. URLs are published now, before
        # the playlist exists, so the player can mount the instant the status
        # turns playable; the web client gates rendering on the status.
        await update_session(
            self.settings, self.session_id,
            status=SessionStatus.INITIALIZING,
            session_urls=build_session_urls(self.session_folder, self.segments_folder, self.settings),
            session_folder=str(self.session_folder),
            nc=self._nc,
        )

        # 3. Resolve the source, then run the resolver's pre-flight smoke test.
        try:
            from mirrorr.startup.ensure_resolvers import get_validated_config

            _res = self.session.resolver

            config = get_validated_config(
                resolvers_dir=self.settings.resolvers_dir,
                origin=_res.origin,
                expected_hash=_res.origin_hash,
                data=self.session.resolver_config,
            )
            source = await self.resolver.resolve(config, self.resolver_ctx)
        except Exception as e:
            self._resolve_failures += 1
            logger.error(f"Failed to resolve source: {e}")
            if self._resolve_failures >= _MAX_RESOLVE_FAILURES:
                return await self._preflight_failed(
                    f"resolve failed {self._resolve_failures}× in a row: {e}"
                )
            return "crashed", EngineCrashed(reason=f"resolve failed: {e}")

        self._resolve_failures = 0

        try:
            await asyncio.wait_for(
                self.resolver.smoke_test(source, config, self.resolver_ctx),
                timeout=self.settings.smoke_test_timeout_s,
            )
        except asyncio.TimeoutError:
            return await self._preflight_failed(
                f"smoke test timed out after {self.settings.smoke_test_timeout_s:g}s"
            )
        except Exception as e:
            return await self._preflight_failed(f"smoke test failed: {e}")

        # A stop that landed during the pre-flight must not start the engine.
        if self._stop.is_set():
            logger.info("stop requested during pre-flight — aborting attempt")
            return "stopped", None

        # 4. Start the engine. A playlist left by a previous attempt must not
        # read as ready, so clear it before the engine writes a fresh one.
        (self.session_folder / "stream.m3u8").unlink(missing_ok=True)
        try:
            self.processes = await self.engine.start(self.engine_ctx, source)
        except Exception as e:
            logger.error(f"Failed to start engine: {e}")
            crash = EngineCrashed(reason=str(e))
            await self.bus.emit("engine.crashed", crash)
            return "crashed", crash

        # 5. Subscribe BEFORE starting processes (C4 fix). Stop is a latched
        # Event, not a bus message, so a stop emitted during bootstrap (before
        # this point) is still observed here.
        done_q = self.bus.subscribe("engine.done")
        crash_q = self.bus.subscribe("engine.crashed")

        done_task = asyncio.create_task(done_q.get())
        crash_task = asyncio.create_task(crash_q.get())
        stop_task = asyncio.create_task(self._stop.wait())

        try:
            for proc in self.processes:
                await proc.start()
        except Exception as e:
            logger.error(f"Failed to start processes: {e}")
            for t in (done_task, crash_task, stop_task):
                t.cancel()
            await asyncio.gather(done_task, crash_task, stop_task, return_exceptions=True)
            await self._cleanup(reason="failed")
            await update_session(self.settings, self.session_id, status=SessionStatus.FAILED, nc=self._nc)
            return "failed", None

        logger.opt(colors=True).success(f"<green>Session</green> bootstrapped — "
                       f"{len(self.processes)} processes running")

        # 6. Wire telemetry + recording stash
        self._wire_telemetry()
        if self._recording:
            self._recording.start_stash()

        # 7. Publish stream_pending, then wait for the first playable playlist.
        await update_session(self.settings, self.session_id, status=SessionStatus.STREAM_PENDING, nc=self._nc)

        ready_task = asyncio.create_task(self._wait_for_playlist())
        lifecycle = [done_task, crash_task, stop_task]
        try:
            finished, _ = await asyncio.wait([ready_task, *lifecycle], return_when=asyncio.FIRST_COMPLETED)

            # A stop or an engine exit beats readiness — a dead run is never marked
            # playable. (stop_task is pre-created, so a stop latched earlier fires
            # immediately here.)
            if not any(t in finished for t in lifecycle):
                await update_session(
                    self.settings, self.session_id,
                    status=SessionStatus.RECORDING if self.session.recording else SessionStatus.ACTIVE,
                    nc=self._nc,
                )
                self._playable = True
                finished, _ = await asyncio.wait(lifecycle, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for t in [ready_task, *lifecycle]:
                if not t.done():
                    t.cancel()
                    try:
                        await t
                    except asyncio.CancelledError:
                        pass

        if stop_task in finished:
            logger.info("stop requested")
            await self._cleanup(reason="stop")
            return "stopped", None

        result = (crash_task if crash_task in finished else done_task).result()

        if isinstance(result, EngineCrashed):
            logger.opt(colors=True).error(f"<red>Session failed</red>: {result.reason}")
            return "crashed", result
        logger.opt(colors=True).success(f"<green>Session</green> completed: {result.reason}")
        return "done", result

    async def _preflight_failed(self, reason: str) -> tuple[str, EngineCrashed]:
        """End the attempt after the resolver's pre-flight rejected the source.

        The probe is the resolver's verdict on the source, not a runtime fault:
        the identical config cannot resolve differently a moment later, so the
        retry policy is not consulted and the session goes straight to FAILED
        with the reason recorded. The row is kept, never deleted. A source that
        has never once resolved falls under the same rule (`_MAX_RESOLVE_FAILURES`).
        """
        logger.opt(colors=True).error(f"<red>Pre-flight failed</red>: {reason}")
        await self._cleanup(reason="failed")
        await update_session(self.settings, self.session_id, status=SessionStatus.FAILED, nc=self._nc)
        return "failed", EngineCrashed(reason=reason)

    async def _wait_for_playlist(self) -> None:
        """Block until the engine has written a non-empty ``stream.m3u8``.

        The poll ends only on readiness; process death and the stop latch are
        observed by the tasks racing this one in ``_run_attempt``.
        """
        playlist = self.session_folder / "stream.m3u8"
        while True:
            try:
                if playlist.stat().st_size > 0:
                    return
            except OSError:
                pass
            await asyncio.sleep(STREAM_READY_POLL_S)

    # ── recording / remux ────────────────────────────────────────────

    async def _do_remux_and_finalize(self, *, delete_after: bool = True) -> None:
        """Shared remux + finalize logic for both normal completion and stop-then-finalize."""
        await update_session(
            self.settings, self.session_id,
            status=SessionStatus.REMUXING, nc=self._nc,
        )
        try:
            recording_id = await self._recording.remux()
            logger.success(f"recording created")
            await update_session(
                self.settings, self.session_id,
                status=SessionStatus.FINALIZING, nc=self._nc,
            )
            await update_session(
                self.settings, self.session_id,
                status=SessionStatus.COMPLETED, nc=self._nc,
            )
            if delete_after:
                await delete_session(
                    self.settings, self.session_id,
                    nc=self._nc, autorun_id=self.session.autorun_id,
                )
            # Publish recording created event
            if recording_id and self._nc:
                try:
                    await self._nc.publish(
                        MirrorrEvent.RECORDING_CREATED.subject,
                        MirrorrEvent.RECORDING_CREATED(id=recording_id).model_dump_json().encode(),
                    )
                except Exception as e:
                    logger.error(f"Failed to emit RECORDING_CREATED: {e}")
        except Exception as e:
            logger.error(f"Remux failed for session {self.session_id}: {e}")
            await update_session(
                self.settings, self.session_id,
                status=SessionStatus.FAILED, nc=self._nc,
            )
            if delete_after:
                await delete_session(
                    self.settings, self.session_id, self.session_folder,
                    nc=self._nc, autorun_id=self.session.autorun_id,
                )

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
        await self._do_remux_and_finalize(delete_after=True)

    async def _finalize_stopped(self) -> None:
        """Handle post-stop finalization: remux recording if active, then mark COMPLETED.

        Unlike _finalize_session(), this does NOT delete the session — a stopped
        session should remain visible in the sidebar.
        """
        if not self._recording:
            await update_session(self.settings, self.session_id, status=SessionStatus.COMPLETED, nc=self._nc)
            return
        await self._do_remux_and_finalize(delete_after=False)

    # ── control channel ──────────────────────────────────────────────

    async def _handle_control(self, command: str) -> None:
        """Handle commands received on the NATS control channel."""
        if command == "stop":
            logger.info(f"received stop command")
            await update_session(self.settings, self.session_id, status=SessionStatus.TERMINATING, nc=self._nc)
            # The run is ending: drop the latch so a later recording toggle
            # cannot publish RECORDING/ACTIVE over TERMINATING.
            self._playable = False
            self.request_stop()
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
                # The gate owns the status: before it publishes ACTIVE/RECORDING
                # a toggle only flags the intent (no premature playable state).
                fields: dict[str, Any] = {"recording": True}
                if self._playable:
                    fields["status"] = SessionStatus.RECORDING
                await update_session(self.settings, self.session_id, nc=self._nc, **fields)
                logger.info(f"recording enabled mid-run")
        elif command == "disable_recording":
            if self.session.recording:
                self.session.recording = False
                if self._recording:
                    await self._recording.stop_stash()
                    self._recording = None
                fields = {"recording": False}
                if self._playable:
                    fields["status"] = SessionStatus.ACTIVE
                await update_session(self.settings, self.session_id, nc=self._nc, **fields)
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
                        try:
                            await self._handle_control(command)
                            if msg.reply:
                                await msg.respond(json.dumps({"ok": True, "command": command}).encode())
                        except Exception as cmd_err:
                            logger.error(f"Control command '{command}' failed: {cmd_err}")
                            if msg.reply:
                                await msg.respond(json.dumps({"error": f"command failed: {cmd_err}"}).encode())
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
        """Coalesce per-process samples into one session-level frame per tick.

        Call after processes start. Each sample only refreshes its own entry,
        so the session publishes at the sampler's own 1 Hz regardless of how
        many processes the attempt runs.
        """
        if not self._nc:
            return
        samples: dict[str, dict[str, Any]] = {}

        async def _collect(name: str, queue: asyncio.Queue) -> None:
            while True:
                sample = await queue.get()
                if isinstance(sample, dict):
                    record_sample(samples, name, sample)

        async def _publish() -> None:
            subject = f"session.{self.session_id}.telemetry"
            while True:
                await asyncio.sleep(TELEMETRY_PUBLISH_INTERVAL_S)
                frame = build_frame(self.session_id, samples, time.time())
                if frame is None:
                    continue
                try:
                    await self._nc.publish(subject, json.dumps(frame).encode())
                except Exception as e:
                    logger.debug(f"Error publishing telemetry for session {self.session_id}: {e}")
                    return

        for proc in self.processes:
            queue = self.bus.subscribe(f"proc.{proc.name}.telemetry")
            self._telemetry_tasks.append(asyncio.create_task(_collect(proc.name, queue)))
        self._telemetry_tasks.append(asyncio.create_task(_publish()))


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
            await self.resolver.stop(self.resolver_ctx)

        for proc in self.processes:
            if proc.running:
                await proc.terminate()

        # Wait concurrently for all processes to exit after SIGTERM
        running_procs = [p for p in self.processes if p.running]
        if running_procs:
            waiters = [asyncio.create_task(p._process.wait()) for p in running_procs if p._process is not None]
            try:
                _, pending = await asyncio.wait(waiters, timeout=5.0)
                for t in pending:
                    t.cancel()
            except asyncio.CancelledError:
                # Shutdown was cancelled — propagate so the caller can handle it.
                raise
            except Exception as e:
                logger.warning(f"Error waiting for processes to exit: {e}")

        for proc in self.processes:
            if proc.running:
                logger.opt(colors=True).warning(f"Force-killing [<cyan>{proc.name}</cyan>]")
                await proc.kill()

        # Close all process handles to release pipe transports
        for proc in self.processes:
            await proc.close()

        logger.info(f"all processes terminated")

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

        # The gate re-runs from scratch: not playable until the next attempt's
        # playlist is ready, and the row drops back to initializing meanwhile.
        self._playable = False
        await update_session(self.settings, self.session_id, status=SessionStatus.INITIALIZING, nc=self._nc)

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
            except Exception as e:
                logger.debug(f"Error unsubscribing from control channel: {e}")
            self._control_sub = None
        try:
            await self._nc.drain()
        except Exception as e:
            logger.debug(f"Error draining NATS connection: {e}")
        self._nc = None


# ── Backward-compatible re-exports ───────────────────────────────────
# runner() and main() now live in session_runner.py.
# Import from there for new code.
from mirrorr.services.session_runner import runner, main
