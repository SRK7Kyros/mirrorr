import multiprocessing
import time
from multiprocessing.synchronize import Event as ShutdownEvent

from loguru import logger

from src.event_bus.nats import bus
from src.event_bus.event import MirrorrEvent
from src.services import session_supervisor

# ── Process registry: session_id → (Process, ShutdownEvent) ──────────
_sessions: dict[int, tuple[multiprocessing.Process, ShutdownEvent]] = {}


def _spawn_supervisor(session_id: int) -> multiprocessing.Process:
    shutdown_event = multiprocessing.Event()
    process = multiprocessing.Process(
        name=f"mirrorr-session-{session_id}",
        target=session_supervisor.main,
        args=(session_id, bus._settings, shutdown_event),
        daemon=True,
    )
    process.start()
    _sessions[session_id] = (process, shutdown_event)
    logger.info(f"Spawned supervisor process (pid={process.pid}) for session {session_id}")
    return process


def _kill_supervisor(session_id: int) -> None:
    entry = _sessions.pop(session_id, None)
    if not entry:
        return
    process, shutdown_event = entry
    if not process.is_alive():
        return

    logger.warning(f"Stopping supervisor process (pid={process.pid}) for session {session_id}")
    shutdown_event.set()
    process.join(timeout=30)
    if process.is_alive():
        logger.warning(f"Force-killing supervisor (pid={process.pid}) for session {session_id}")
        try:
            process.kill()
        except OSError:
            pass
        process.join(timeout=3)


# ── Session lifecycle ────────────────────────────────────────────────

@bus.on(MirrorrEvent.SESSION_CREATED)
async def handle_session_created(data: MirrorrEvent.SESSION_CREATED):
    _spawn_supervisor(data.id)


@bus.on(MirrorrEvent.SESSION_DELETED)
async def handle_session_deleted(data: MirrorrEvent.SESSION_DELETED):
    _kill_supervisor(data.id)


# ── Autorun lifecycle ────────────────────────────────────────────────

@bus.on(MirrorrEvent.AUTORUN_CREATED)
async def handle_autorun_created(data: MirrorrEvent.AUTORUN_CREATED):
    logger.info(f"Autorun {data.id} created — scheduler will pick it up on next tick")


@bus.on(MirrorrEvent.AUTORUN_DELETED)
async def handle_autorun_deleted(data: MirrorrEvent.AUTORUN_DELETED):
    """When an autorun is deleted, stop its session if one is running."""
    from src.storage.database import create_db_engine
    from src.storage.models import Session, SessionStatus
    from sqlmodel import select

    db_engine, session_factory = create_db_engine(bus._settings)
    try:
        async with session_factory() as db:
            stmt = select(Session).where(Session.autorun_id == data.id)
            result = await db.exec(stmt)
            session = result.first()

            if session and session.status in (SessionStatus.ACTIVE, SessionStatus.RECORDING):
                logger.info(f"Autorun {data.id} deleted — stopping session {session.id}")
                _kill_supervisor(session.id)
                session.status = SessionStatus.FAILED
                db.add(session)
                await db.commit()
    except Exception as e:
        logger.error(f"Failed to handle autorun deletion {data.id}: {e}")
    finally:
        await db_engine.dispose()


# ── Recording lifecycle ──────────────────────────────────────────────

@bus.on(MirrorrEvent.RECORDING_CREATED)
async def handle_recording_created(data: MirrorrEvent.RECORDING_CREATED):
    logger.info(f"Recording {data.id} created")


# ── Cleanup on shutdown ──────────────────────────────────────────────

def kill_all_supervisors() -> None:
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

        time.sleep(poll_interval)

    # 3. Force-kill any that are still alive
    for session_id, (process, _) in list(_sessions.items()):
        if process.is_alive():
            logger.warning(f"  Force-killing session {session_id} (pid={process.pid})")
            try:
                process.kill()
            except OSError:
                pass
            process.join(timeout=3)

    if done:
        logger.info(f"All {len(done)} supervisor(s) stopped gracefully")
