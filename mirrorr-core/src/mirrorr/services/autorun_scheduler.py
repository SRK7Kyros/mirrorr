import asyncio
import json
from datetime import datetime, timezone

from loguru import logger
from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncEngine
from sqlalchemy.orm import selectinload
from sqlmodel import select

from mirrorr.event_bus.nats import bus, get_control_nc
from mirrorr.event_bus.event import MirrorrEvent
from mirrorr.storage.models import Autorun, Session, Profile
from mirrorr.storage.enums import AutorunStatus, SessionStatus
from mirrorr.storage import crud
from mirrorr.startup.config import MirrorrSettings
from mirrorr.services.session_lifecycle import update_autorun


async def autorun_scheduler_loop(
    settings: MirrorrSettings,
    session_factory: async_sessionmaker,
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
                await _tick(session_factory, settings)
            except Exception as e:
                logger.error(f"Autorun scheduler tick failed: {e}")

            try:
                await asyncio.wait_for(stop_event.wait(), timeout=interval)
                break  # stop_event was set
            except asyncio.TimeoutError:
                pass  # normal — just means the interval elapsed
    finally:
        logger.info("Autorun scheduler stopped")


async def _tick(session_factory: async_sessionmaker, settings: MirrorrSettings) -> None:
    # Use naive UTC to match the naive UTC datetimes stored in the DB
    # (SQLite strips tzinfo, and _parse_datetimes stores naive UTC)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    just_created_ids: set[int] = set()

    async with session_factory() as db:
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
                    autorun.status = AutorunStatus.ACTIVE
                    autorun.next_run_at = None
                    autorun.last_run_at = now
                    db.add(autorun)

                    session = Session(
                        profile_id=autorun.profile_id,
                        autorun_id=autorun.id,
                        engine_id=autorun.engine_id,
                        resolver_id=autorun.resolver_id,
                        resolver_config=autorun.resolver_config,
                        retry_mode=autorun.retry_mode,
                        retry_config=autorun.retry_config,
                        requester_user_token=autorun.requester_user_token or f"autorun:{autorun.id}",
                        recording=autorun.recording,
                    )
                    session = await crud.create(db, session)
                    just_created_ids.add(session.id)
                    created_session_ids.append(session.id)
                    updated_autorun_ids.append(autorun.id)

                    # Subscribe the autorun's owner to session events so they
                    # receive per-resource WS events (telemetry, recording state, etc.)
                    if autorun.requester_user_token:
                        from mirrorr.api.auth import subscribe_requester
                        from mirrorr.storage.enums import ResourceType
                        await subscribe_requester(db, autorun.requester_user_token, ResourceType.SESSION, session.id)
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

    async with session_factory() as db:
        # ── 2. Stop autoruns whose end_time has passed ────────────────
        stmt = (
            select(Session)
            .where(
                Session.autorun_id.is_not(None),  # ty:ignore
                Session.status.in_([SessionStatus.ACTIVE, SessionStatus.RECORDING]),  # ty:ignore
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
