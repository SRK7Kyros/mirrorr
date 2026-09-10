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
_sessions: dict[int, tuple[multiprocessing.Process, ShutdownEvent]] = {}


def _spawn_supervisor(session_id: int) -> multiprocessing.Process:
    from mirrorr.di import container
    shutdown_event = multiprocessing.Event()
    process = multiprocessing.Process(
        name=f"mirrorr-session-{session_id}",
        target=session_supervisor.main,
        args=(session_id, container.settings, shutdown_event),
        daemon=True,
    )
    process.start()
    _sessions[session_id] = (process, shutdown_event)
    logger.info(f"Spawned supervisor process (pid={process.pid}) for session {session_id}")
    return process


async def _kill_supervisor(session_id: int) -> None:
    entry = _sessions.pop(session_id, None)
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

    session_factory = container.session_factory
    try:
        async with session_factory() as db:
            stmt = select(Session).where(Session.autorun_id == data.id)
            result = await db.exec(stmt)
            session = result.first()

            if session and session.status in (SessionStatus.ACTIVE, SessionStatus.RECORDING):
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
    """Create notifications for all subscribed users via a standalone DB session."""
    from mirrorr.di import container
    from mirrorr.api.auth import notify_subscribers

    session_factory = container.session_factory
    try:
        async with session_factory() as db:
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

async def kill_all_supervisors() -> None:
    """Gracefully stop all running supervisors, then force-kill stragglers.

    Signals each supervisor via its multiprocessing.Event, waits for clean
    exit (including remux), then force-kills survivors.
    """
    if not _sessions:
        return

    logger.info(f"Stopping {len(_sessions)} supervisor(s): {list(_sessions.keys())}")

    # 1. Signal all supervisors to stop via the shutdown event
    for session_id, (process, shutdown_event) in _sessions.items():
        logger.info(f"  Signaling stop to session {session_id} (pid={process.pid})")
        shutdown_event.set()

    # 2. Wait for them to exit — with progress logging
    done: set[int] = set()
    start = time.monotonic()
    poll_interval = 0.5
    log_interval = 10
    next_log = start + log_interval

    while True:
        newly_done = set()
        for session_id, (process, _) in _sessions.items():
            if session_id in done:
                continue
            if not process.is_alive():
                newly_done.add(session_id)
                logger.info(f"  Session {session_id} exited")

        done.update(newly_done)
        remaining = [sid for sid in _sessions if sid not in done]

        if not remaining:
            break

        now = time.monotonic()
        if now >= next_log:
            elapsed = int(now - start)
            logger.info(f"  Still waiting for {len(remaining)} session(s): {remaining} ({elapsed}s elapsed)")
            next_log = now + log_interval

        await asyncio.sleep(poll_interval)

    # 3. Force-kill any that are still alive
    for session_id, (process, _) in list(_sessions.items()):
        if process.is_alive():
            logger.warning(f"  Force-killing session {session_id} (pid={process.pid})")
            try:
                process.kill()
            except (OSError, ProcessLookupError):
                pass
            await asyncio.to_thread(process.join, timeout=3)

    if done:
        logger.success(f"All {len(done)} supervisor(s) stopped gracefully")
