import asyncio
import multiprocessing
import time
from multiprocessing.synchronize import Event as ShutdownEvent

from loguru import logger

from mirrorr.event_bus.nats import bus
from mirrorr.event_bus.event import MirrorrEvent
from mirrorr.services import session_supervisor
from mirrorr.storage.enums import ResourceType

# ── Process registry: session_id → (Process, ShutdownEvent) ──────────
_supervisors: dict[int, tuple[multiprocessing.Process, ShutdownEvent]] = {}


def _spawn_supervisor(session_id: int) -> multiprocessing.Process:
    from mirrorr.di import container
    existing = _supervisors.get(session_id)
    if existing is not None and existing[0].is_alive():
        logger.warning(
            f"Supervisor for session {session_id} is already running "
            f"(pid={existing[0].pid}); ignoring duplicate spawn"
        )
        return existing[0]
    shutdown_event = multiprocessing.Event()
    process = multiprocessing.Process(
        name=f"mirrorr-session-{session_id}",
        target=session_supervisor.main,
        args=(session_id, container.settings, shutdown_event),
        daemon=True,
    )
    process.start()
    _supervisors[session_id] = (process, shutdown_event)
    logger.info(f"Spawned supervisor process (pid={process.pid}) for session {session_id}")
    return process


async def _kill_supervisor(session_id: int) -> None:
    entry = _supervisors.pop(session_id, None)
    if not entry:
        return
    process, shutdown_event = entry
    if not process.is_alive():
        return

    logger.warning(f"Stopping supervisor process (pid={process.pid}) for session {session_id}")
    shutdown_event.set()
    await asyncio.to_thread(process.join, timeout=30)
    if process.is_alive():
        logger.warning(f"Force-killing supervisor (pid={process.pid}) for session {session_id}")
        try:
            process.kill()
        except OSError:
            pass
        await asyncio.to_thread(process.join, timeout=3)


# ── Session lifecycle ────────────────────────────────────────────────

@bus.on(MirrorrEvent.SESSION_CREATED)
async def handle_session_created(data: MirrorrEvent.SESSION_CREATED):
    _spawn_supervisor(data.id)


@bus.on(MirrorrEvent.SESSION_DELETED)
async def handle_session_deleted(data: MirrorrEvent.SESSION_DELETED):
    await _kill_supervisor(data.id)


# ── Autorun lifecycle ────────────────────────────────────────────────

@bus.on(MirrorrEvent.AUTORUN_CREATED)
async def handle_autorun_created(data: MirrorrEvent.AUTORUN_CREATED):
    logger.info(f"Autorun {data.id} created — scheduler will pick it up on next tick")


@bus.on(MirrorrEvent.AUTORUN_DELETED)
async def handle_autorun_deleted(data: MirrorrEvent.AUTORUN_DELETED):
    """When an autorun is deleted, stop and delete its session if one is running."""
    from mirrorr.di import container
    from mirrorr.storage.models import Session
    from mirrorr.storage.enums import SessionStatus
    from sqlmodel import select

    db_factory = container.db_factory
    try:
        async with db_factory() as db:
            stmt = select(Session).where(Session.autorun_id == data.id)
            result = await db.exec(stmt)
            session = result.first()

            if session and session.status in (
                SessionStatus.INITIALIZING,
                SessionStatus.STREAM_PENDING,
                SessionStatus.ACTIVE,
                SessionStatus.RECORDING,
            ):
                logger.info(f"Autorun {data.id} deleted — stopping & deleting session {session.id}")
                await _kill_supervisor(session.id)
                # Delete the session (DB row + folder) so we don't leak
                # resources. delete_session emits SESSION_DELETED itself.
                from mirrorr.services.session_lifecycle import delete_session
                await delete_session(
                    container.settings,
                    session.id,
                    None,  # session_folder derived by caller if needed
                    autorun_id=session.autorun_id,
                )
    except Exception as e:
        logger.error(f"Failed to handle autorun deletion {data.id}: {e}")


# ── Notification-producing event handlers ────────────────────────────

async def _create_notification(resource_type: str, resource_id: int, event_type: str, title: str, body: str = "") -> None:
    """Create notifications for all subscribed users via a standalone DB handle."""
    from mirrorr.di import container
    from mirrorr.api.auth import notify_subscribers

    db_factory = container.db_factory
    try:
        async with db_factory() as db:
            count = await notify_subscribers(db, resource_type, resource_id, event_type, title, body)
            if count:
                await db.commit()
                logger.info(f"Notification: {title} → {count} user(s)")
    except Exception as e:
        logger.error(f"Failed to create notification: {e}")


@bus.on(MirrorrEvent.SESSION_STARTED)
async def handle_session_started(data: MirrorrEvent.SESSION_STARTED):
    await _create_notification(
        ResourceType.SESSION, data.id, "session.started",
        title=f"Session {data.id} started",
    )


@bus.on(MirrorrEvent.SESSION_STOPPED)
async def handle_session_stopped(data: MirrorrEvent.SESSION_STOPPED):
    await _create_notification(
        ResourceType.SESSION, data.id, "session.stopped",
        title=f"Session {data.id} stopped",
    )


@bus.on(MirrorrEvent.SESSION_CRASHED)
async def handle_session_crashed(data: MirrorrEvent.SESSION_CRASHED):
    await _create_notification(
        ResourceType.SESSION, data.id, "session.crashed",
        title=f"Session {data.id} crashed",
        body="The session terminated unexpectedly.",
    )


@bus.on(MirrorrEvent.RECORDING_CREATED)
async def handle_recording_created(data: MirrorrEvent.RECORDING_CREATED):
    await _create_notification(
        ResourceType.RECORDING, data.id, "recording.created",
        title=f"Recording {data.id} created",
    )


# ── Cleanup on shutdown ──────────────────────────────────────────────

async def kill_all_supervisors(timeout: float = 20.0) -> None:
    """Gracefully stop all running supervisors, then force-kill stragglers.

    Signals each supervisor via its multiprocessing.Event and waits up to
    *timeout* for a clean exit (including remux). Anything still alive is
    force-killed — unbounded, one wedged supervisor would stall shutdown
    until systemd SIGKILLs the whole cgroup, orphaning every session row.
    """
    if not _supervisors:
        return

    logger.info(f"Stopping {len(_supervisors)} supervisor(s): {list(_supervisors.keys())}")

    # 1. Signal all supervisors to stop via the shutdown event
    for session_id, (process, shutdown_event) in _supervisors.items():
        logger.info(f"  Signaling stop to session {session_id} (pid={process.pid})")
        shutdown_event.set()

    # 2. Wait for them to exit — with progress logging
    done: set[int] = set()
    start = time.monotonic()
    poll_interval = 0.5
    log_interval = 10
    next_log = start + log_interval

    while True:
        for session_id, (process, _) in _supervisors.items():
            if session_id not in done and not process.is_alive():
                done.add(session_id)
                logger.info(f"  Session {session_id} exited")

        remaining = [sid for sid in _supervisors if sid not in done]
        if not remaining:
            break

        now = time.monotonic()
        if now - start >= timeout:
            logger.warning(f"  {len(remaining)} supervisor(s) did not stop in {timeout:.0f}s: {remaining}")
            break
        if now >= next_log:
            logger.info(f"  Still waiting for {len(remaining)} session(s): {remaining} ({int(now - start)}s elapsed)")
            next_log = now + log_interval

        await asyncio.sleep(poll_interval)

    # 3. Force-kill any that are still alive
    killed: list[int] = []
    for session_id, (process, _) in list(_supervisors.items()):
        if process.is_alive():
            logger.warning(f"  Force-killing session {session_id} (pid={process.pid})")
            try:
                process.kill()
            except (OSError, ProcessLookupError):
                pass
            await asyncio.to_thread(process.join, timeout=3)
            killed.append(session_id)

    _supervisors.clear()
    logger.success(
        f"Stopped {len(done)} supervisor(s) gracefully"
        + (f", force-killed {len(killed)}: {killed}" if killed else "")
    )


# ── Liveness watchdog ────────────────────────────────────────────────
# A supervisor is a child process; when it dies the session row is left in a
# live status with nobody driving it, and stopping it fails with no responders.
# The registry is in-memory, so this is the only place that can tell a running
# session from an abandoned one.
_WATCHDOG_INTERVAL = 15.0
# A supervisor is spawned milliseconds after its session row, so a short grace
# period avoids failing a session that is merely still starting.
_WATCHDOG_GRACE = 30.0


async def _sweep_dead_supervisors(missing_since: dict[int, float]) -> list[int]:
    """Session ids in a live status whose supervisor has been gone past the grace.

    *missing_since* is mutated in place: it records when each session was first
    seen without a live supervisor, so one that is merely slow to spawn is not
    failed on the first tick.
    """
    from sqlmodel import select

    from mirrorr.di import container
    from mirrorr.services.session_lifecycle import LIVE_STATUSES
    from mirrorr.storage.models import Session

    async with container.db_factory() as db:
        live = list(
            (await db.exec(select(Session.id).where(Session.status.in_(LIVE_STATUSES)))).all()
        )

    now = time.monotonic()
    dead: list[int] = []
    for session_id in live:
        entry = _supervisors.get(session_id)
        if entry is not None and entry[0].is_alive():
            missing_since.pop(session_id, None)
        elif now - missing_since.setdefault(session_id, now) >= _WATCHDOG_GRACE:
            dead.append(session_id)

    live_set = set(live)
    for session_id in [sid for sid in missing_since if sid not in live_set]:
        missing_since.pop(session_id)
    for session_id, (process, _) in list(_supervisors.items()):
        if session_id not in live_set and not process.is_alive():
            _supervisors.pop(session_id)
    return dead


async def supervisor_watchdog_loop(stop_event: asyncio.Event) -> None:
    """Fail sessions whose supervisor process has died."""
    from mirrorr.di import container
    from mirrorr.services.session_lifecycle import update_session
    from mirrorr.storage.enums import SessionStatus

    missing_since: dict[int, float] = {}
    logger.info(f"Supervisor watchdog started (interval={_WATCHDOG_INTERVAL:.0f}s)")
    try:
        while not stop_event.is_set():
            try:
                for session_id in await _sweep_dead_supervisors(missing_since):
                    missing_since.pop(session_id, None)
                    _supervisors.pop(session_id, None)
                    logger.warning(f"Session {session_id} has no live supervisor — marking FAILED")
                    await update_session(container.settings, session_id, status=SessionStatus.FAILED)
            except Exception as e:
                logger.error(f"Supervisor watchdog tick failed: {e}")

            try:
                await asyncio.wait_for(stop_event.wait(), timeout=_WATCHDOG_INTERVAL)
                break
            except asyncio.TimeoutError:
                pass
    finally:
        logger.info("Supervisor watchdog stopped")
