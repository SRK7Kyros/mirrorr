import asyncio
import json
from datetime import datetime, timezone

from loguru import logger
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlalchemy.orm import selectinload
from sqlmodel import select

from mirrorr.event_bus.nats import bus, get_control_nc
from mirrorr.event_bus.event import MirrorrEvent
from mirrorr.storage.models import Autorun, Session, Profile
from mirrorr.storage.enums import AutorunStatus, SessionStatus
from mirrorr.storage import crud
from mirrorr.startup.config import MirrorrSettings


async def autorun_scheduler_loop(
    settings: MirrorrSettings,
    db_factory: async_sessionmaker,
    stop_event: asyncio.Event,
) -> None:
    """Background loop that starts/stops sessions based on Autorun schedules.

    Runs every ``settings.autorun_check_interval`` seconds until *stop_event* is set.
    """
    interval = settings.autorun_check_interval
    logger.info(f"Autorun scheduler started (interval={interval}s)")

    try:
        while not stop_event.is_set():
            try:
                await _tick(db_factory, settings)
            except Exception as e:
                logger.error(f"Autorun scheduler tick failed: {e}")

            try:
                await asyncio.wait_for(stop_event.wait(), timeout=interval)
                break  # stop_event was set
            except asyncio.TimeoutError:
                pass  # normal — just means the interval elapsed
    finally:
        logger.info("Autorun scheduler stopped")


def slot_key(autorun: Autorun, tag: str = "slot") -> str:
    """Identity of one autorun slot; a slot starts at most one session, ever."""
    return f"autorun:{autorun.id}:{tag}:{autorun.start_time.isoformat(timespec='seconds')}"


def fallback_chain(autorun: Autorun) -> list[int | None]:
    """The profiles this autorun tries, in order: its own, then the fallbacks."""
    chain: list[int | None] = [autorun.profile_id]
    for pid in autorun.fallback_profile_ids or []:
        if pid not in chain:
            chain.append(pid)
    return chain


async def _spawn_session(db, autorun: Autorun, now: datetime, key: str) -> int | None:
    """Create the session for one slot, or ``None`` if that slot already ran.

    One slot is one session even when its capture falls back: the session carries
    the whole chain in ``capture_plan`` and runs it itself, so a fallback never
    spawns a session of its own.
    """
    used = (await db.exec(select(Session.id).where(Session.idempotency_key == key))).first()
    if used is not None:
        logger.warning(f"Autorun {autorun.id}: slot {key} already started session {used}, skipping")
        return None

    autorun.status = AutorunStatus.ACTIVE
    autorun.next_run_at = None
    autorun.last_run_at = now
    db.add(autorun)

    session = Session(
        id=await crud.next_free_id(db, Session),
        autorun_id=autorun.id,
        requester_user_token=autorun.requester_user_token
        or ("" if autorun.requester_group_id is not None else f"autorun:{autorun.id}"),
        requester_group_id=autorun.requester_group_id,
        recording=autorun.recording,
        idempotency_key=key,
        profile_id=autorun.profile_id,
        engine_id=autorun.engine_id,
        resolver_id=autorun.resolver_id,
        resolver_config=autorun.resolver_config,
        retry_mode=autorun.retry_mode,
        retry_config=autorun.retry_config,
        capture_plan=fallback_chain(autorun),
    )
    db.add(session)
    await db.flush()

    # Subscribe the autorun's owner to session events so they
    # receive per-resource WS events (telemetry, recording state, etc.)
    if autorun.requester_user_token:
        from mirrorr.api.auth import subscribe_requester
        from mirrorr.storage.enums import ResourceType
        await subscribe_requester(
            db, autorun.requester_user_token, ResourceType.SESSION, session.id, commit=False
        )

    # The session inherits the autorun's access: whoever can see
    # the scheduled item can see what it produced.
    from mirrorr.services.permissions import inherit_access
    await inherit_access(db, autorun, session)
    return session.id


async def _tick(db_factory: async_sessionmaker, settings: MirrorrSettings) -> None:
    # Use naive UTC to match the naive UTC datetimes stored in the DB
    # (SQLite strips tzinfo, and _parse_datetimes stores naive UTC)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    just_created_ids: set[int] = set()

    async with db_factory() as db:
        # ── 1. Start scheduled autoruns whose start_time has arrived ──
        stmt = (
            select(Autorun)
            .where(
                Autorun.start_time <= now,
                Autorun.status == AutorunStatus.SCHEDULED,
            )
            .options(
                selectinload(Autorun.profile).selectinload(Profile.resolver),  # ty:ignore[invalid-argument-type]
                selectinload(Autorun.engine),  # ty:ignore[invalid-argument-type]
            )
        )
        result = await db.exec(stmt)
        due_autoruns: list[Autorun] = list(result.all())

        created_session_ids: list[int] = []
        updated_autorun_ids: list[int] = []

        for autorun in due_autoruns:
            logger.info(f"Autorun {autorun.id} ({autorun.user_friendly_name}): "
                        f"start_time reached, creating session")

            # M4 fix: use a savepoint per autorun so a failure in session
            # creation for one autorun does not roll back the status
            # updates of the others. The outer transaction still commits
            # the successful ones.
            try:
                async with db.begin_nested():
                    session_id = await _spawn_session(db, autorun, now, slot_key(autorun))
                    if session_id is not None:
                        just_created_ids.add(session_id)
                        created_session_ids.append(session_id)
                        updated_autorun_ids.append(autorun.id)
            except Exception as e:
                logger.error(f"Autorun {autorun.id} session creation failed (status not persisted): {e}")
                # Savepoint rolled back; this autorun stays SCHEDULED and
                # will be retried on the next tick.

        await db.commit()

        # Emit AFTER commit so the UI re-fetches fresh data
        for sid in created_session_ids:
            await bus.emit(MirrorrEvent.SESSION_CREATED(id=sid))
        for aid in updated_autorun_ids:
            await bus.emit(MirrorrEvent.AUTORUN_UPDATED(id=aid))

    # ── 2. Stop autoruns whose end_time has passed ────────────────
    async with db_factory() as db:
        stmt = (
            select(Session)
            .where(
                Session.autorun_id.is_not(None),  # ty:ignore
                Session.status.in_([  # ty:ignore
                    SessionStatus.INITIALIZING,
                    SessionStatus.STREAM_PENDING,
                    SessionStatus.ACTIVE,
                    SessionStatus.RECORDING,
                ]),
            )
            .options(selectinload(Session.autorun))  # ty:ignore
        )
        result = await db.exec(stmt)
        active_sessions: list[Session] = list(result.all())

        for session in active_sessions:
            if not session.autorun or session.autorun.end_time > now:
                continue

            # Don't stop a session we just created this tick — the supervisor
            # hasn't started its NATS bridge yet, so the stop would fail.
            if session.id in just_created_ids:
                logger.debug(f"Autorun {session.autorun_id}: session {session.id} "
                             f"just created, deferring stop to next tick")
                continue

            logger.info(f"Autorun {session.autorun_id}: end_time reached, "
                        f"stopping session {session.id}")

            event = MirrorrEvent.SESSION_STOP_REQUESTED(id=session.id, command="stop")
            try:
                nc = await get_control_nc()
                msg = await nc.request(
                    f"session.{session.id}.control",
                    event.model_dump_json().encode(),
                    timeout=5.0,
                )
                reply = json.loads(msg.data.decode())
                if "error" in reply:
                    logger.error(f"Autorun {session.autorun_id}: stop failed for session {session.id}: {reply['error']}")
                else:
                    logger.info(f"Autorun {session.autorun_id}: stop acknowledged for session {session.id}")
            except Exception:
                logger.warning(f"Autorun {session.autorun_id}: session {session.id} supervisor not responding")
