"""Universal helpers for session and autorun state mutations.

Every field change on a Session or Autorun goes through these helpers,
which guarantee:
1. The entity is loaded from DB
2. Fields are applied
3. A diff is computed (old → new)
4. The diff is committed to DB
5. NATS events are emitted based on what changed:
   - SESSION_UPDATED / AUTORUN_UPDATED always
   - If status changed: lifecycle events (STARTED/STOPPED/CRASHED)
   - If session status changed: autorun status is propagated
   - If session was deleted: SESSION_DELETED + AUTORUN_UPDATED

DB access strategy:
- Main process: uses the DI container's shared db_factory
- Subprocess (supervisor): falls back to creating a fresh engine from settings

Usage:
    from mirrorr.services.session_lifecycle import update_session, delete_session, update_autorun

    # Status change (auto-sets started_at/ended_at, propagates to autorun)
    await update_session(settings, session_id, status=SessionStatus.FAILED, nc=nc)

    # Arbitrary field change (emits SESSION_UPDATED)
    await update_session(settings, session_id, session_urls=[...], nc=nc)
    await update_session(settings, session_id, recording=True, nc=nc)

    # Multiple fields at once
    await update_session(settings, session_id, status=SessionStatus.RECORDING, recording=True, nc=nc)

    # Autorun field change
    await update_autorun(settings, autorun_id, status=AutorunStatus.ACTIVE, nc=nc)
"""

from __future__ import annotations

import asyncio
import shutil
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, TYPE_CHECKING

from loguru import logger
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlmodel import select

from mirrorr.event_bus.event import MirrorrEvent
from mirrorr.storage.models import (
    Autorun,
    AutorunStatus,
    Recording,
    Session,
    SessionStatus,
)

if TYPE_CHECKING:
    from nats.aio.client import Client as NATS
    from mirrorr.startup.config import MirrorrSettings


# ── Status mapping: Session → Autorun ────────────────────────────────

_STATUS_MAP: dict[SessionStatus, AutorunStatus] = {
    SessionStatus.INITIALIZING: AutorunStatus.ACTIVE,
    SessionStatus.STREAM_PENDING: AutorunStatus.ACTIVE,
    SessionStatus.ACTIVE: AutorunStatus.ACTIVE,
    SessionStatus.RECORDING: AutorunStatus.RECORDING,
    SessionStatus.TERMINATING: AutorunStatus.TERMINATING,
    SessionStatus.REMUXING: AutorunStatus.REMUXING,
    SessionStatus.FINALIZING: AutorunStatus.FINALIZING,
    SessionStatus.COMPLETED: AutorunStatus.COMPLETED,
    SessionStatus.FAILED: AutorunStatus.FAILED,
}


class SessionNotFoundError(RuntimeError):
    """Raised when a session update targets a row that no longer exists.

    Callers (e.g. ``SessionSupervisor.run``) should catch this and abort
    their loop rather than continuing to operate on a phantom session.
    """

    def __init__(self, session_id: int) -> None:
        super().__init__(f"Session {session_id} not found")
        self.session_id = session_id


@asynccontextmanager
async def _get_db_factory(
    settings: MirrorrSettings | None = None,
) -> AsyncGenerator[async_sessionmaker, None]:
    """Get a db factory, preferring the DI container.

    In the main process, the DI container holds a shared factory.
    In subprocesses (supervisor), the container isn't wired, so we
    create a fresh engine from settings and dispose it when done.
    """
    # Try DI container first (main process). Resolve the factory *before*
    # yielding: an exception thrown into the generator at the yield would
    # otherwise be caught below (SessionNotFoundError subclasses RuntimeError),
    # making the generator yield a second time and corrupting the context
    # manager ("generator didn't stop after athrow()").
    factory = None
    try:
        from mirrorr.di import container
        factory = container.db_factory
    except (RuntimeError, ImportError):
        factory = None

    if factory is not None:
        yield factory
        return

    # Fallback: create engine from settings (subprocess)
    if settings is None:
        raise RuntimeError("No DI container and no settings — cannot get a db factory")
    from mirrorr.storage.database import create_db_engine
    db_engine, db_factory = create_db_engine(settings)
    try:
        yield db_factory
    finally:
        await db_engine.dispose()


async def update_session(
    settings: MirrorrSettings,
    session_id: int,
    *,
    nc: NATS | None = None,
    **fields: Any,
) -> dict[str, tuple[Any, Any]]:
    """Generic session update: load → apply fields → diff → commit → emit.

    Returns the diff dict ``{field_name: (old_value, new_value)}`` for
    every field that actually changed.

    Side effects computed from the diff:
    - ``status`` changed → propagate to autorun, emit lifecycle events
    - ``status`` is terminal → set ``ended_at``
    - Any field changed → emit ``SESSION_UPDATED``
    """
    from mirrorr.storage import crud

    if not fields:
        return {}

    diff: dict[str, tuple[Any, Any]] = {}
    autorun_id: int | None = None
    try:
        async with _get_db_factory(settings) as db_factory:
            async with db_factory() as db:
                session = await crud.get_by_id(db, Session, session_id)
                if not session:
                    # Session was deleted between the caller's fetch and this
                    # update. Raise so callers (e.g. supervisors) can abort
                    # instead of continuing to operate on a phantom row.
                    raise SessionNotFoundError(session_id)

                # ── Compute diff and apply ───────────────────────────────
                for key, new_val in fields.items():
                    old_val = getattr(session, key, None)
                    if old_val != new_val:
                        diff[key] = (old_val, new_val)
                        setattr(session, key, new_val)

                # ── Auto-set timestamps ──────────────────────────────────
                # started_at marks the first time the session is seen running.
                # It cannot hang off the status diff: a session row is created
                # already ACTIVE, so its first ACTIVE update is a no-op diff.
                if session.status in (SessionStatus.ACTIVE, SessionStatus.RECORDING):
                    if not session.started_at:
                        session.started_at = datetime.now(timezone.utc).replace(tzinfo=None)
                        diff["started_at"] = (None, session.started_at)

                if "status" in diff:
                    new_status = diff["status"][1]

                    # Set ended_at when reaching a terminal state
                    if new_status in (SessionStatus.COMPLETED, SessionStatus.FAILED):
                        if not session.ended_at:
                            session.ended_at = datetime.now(timezone.utc).replace(tzinfo=None)
                            diff["ended_at"] = (None, session.ended_at)

                # ── Commit ───────────────────────────────────────────────
                if diff:
                    await crud.update(db, Session, session_id, session)

                    # ── Propagate status to autorun ──────────────────────
                    # Only the autorun's newest session speaks for it, so a
                    # rung that failed before its fallback took over cannot
                    # overwrite the fallback's live status when it lands late.
                    if "status" in diff and session.autorun_id:
                        newest = (
                            await db.exec(
                                select(Session.id)
                                .where(Session.autorun_id == session.autorun_id)
                                .order_by(Session.id.desc())
                                .limit(1)
                            )
                        ).first()
                        autorun = (
                            await crud.get_by_id(db, Autorun, session.autorun_id)
                            if newest == session_id
                            else None
                        )
                        if autorun:
                            new_status = diff["status"][1]
                            mapped = _STATUS_MAP.get(new_status)
                            if mapped and autorun.status != mapped:
                                autorun.status = mapped
                                await crud.update(db, Autorun, autorun.id, autorun)
                                autorun_id = autorun.id
    except Exception as e:
        logger.error(f"Failed to update session {session_id}: {e}")
        raise  # Re-raise so callers can handle the failure

    # ── Emit NATS events based on diff ────────────────────────────────
    if diff:
        await _emit_session_diff(nc, session_id, diff, autorun_id)

    return diff


# Statuses that imply a supervisor should be alive. Supervisors are child
# processes of the core, so none can survive a restart — a row still in one of
# these at boot, or after its supervisor died, has nobody left to drive it.
# Shared with the liveness watchdog in event_bus.handlers.
LIVE_STATUSES = (
    SessionStatus.INITIALIZING,
    SessionStatus.STREAM_PENDING,
    SessionStatus.ACTIVE,
    SessionStatus.RECORDING,
    SessionStatus.TERMINATING,
    SessionStatus.REMUXING,
    SessionStatus.FINALIZING,
)


async def live_folder_holder(
    settings: MirrorrSettings,
    folder: Path,
    session_id: int,
) -> int | None:
    """The id of another live session already writing into ``folder``.

    A folder holds one playlist and one segment set, so a second session
    writing there would interleave its segments with the first one's.
    """
    async with _get_db_factory(settings) as db_factory:
        async with db_factory() as db:
            return (
                await db.exec(
                    select(Session.id)
                    .where(
                        Session.session_folder == str(folder),
                        Session.status.in_(LIVE_STATUSES),
                        Session.id != session_id,
                    )
                    .limit(1)
                )
            ).first()


async def fail_orphaned_sessions(
    settings: MirrorrSettings,
    nc: NATS | None = None,
) -> list[int]:
    """Fail every session left mid-flight by a previous core process.

    Without this a restarted core shows sessions stuck as running that no
    supervisor is serving, and stopping one times out because its control
    command has no subscriber. An autorun that opted into ``retry`` then gets a
    fresh session, so a restart does not silently cost it the rest of its window.
    """
    async with _get_db_factory(settings) as db_factory:
        async with db_factory() as db:
            orphaned = list(
                (await db.exec(select(Session.id).where(Session.status.in_(LIVE_STATUSES)))).all()
            )

    for session_id in orphaned:
        await update_session(settings, session_id, status=SessionStatus.FAILED, nc=nc)
    if orphaned:
        logger.warning(f"Failed {len(orphaned)} orphaned session(s) left by a previous run: {orphaned}")
    await _retry_orphaned_autoruns(settings, orphaned)
    return orphaned


async def _retry_orphaned_autoruns(settings: MirrorrSettings, orphaned: list[int]) -> None:
    """Start a fresh session per orphaned autorun whose ``orphan_policy`` is
    ``retry``, while its window is still open. One retry per orphan, ever —
    the session's idempotency key names the orphan it replaces."""
    from sqlalchemy.orm import selectinload

    from mirrorr.event_bus.nats import bus
    from mirrorr.services.autorun_scheduler import _spawn_session, slot_key

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    started: list[tuple[int, int]] = []

    async with _get_db_factory(settings) as db_factory:
        async with db_factory() as db:
            rows = (
                await db.exec(
                    select(Session)
                    .where(Session.id.in_(orphaned))  # ty:ignore
                    .options(selectinload(Session.autorun))  # ty:ignore
                )
            ).all()
            for row in rows:
                autorun = row.autorun
                if autorun is None or autorun.orphan_policy != "retry":
                    continue
                if autorun.end_time <= now:
                    logger.info(f"Autorun {autorun.id}: window closed, not retrying session {row.id}")
                    continue
                try:
                    async with db.begin_nested():
                        session_id = await _spawn_session(
                            db, autorun, now, slot_key(autorun, f"retry-{row.id}")
                        )
                except Exception as e:
                    logger.error(f"Autorun {autorun.id}: retry after boot failed: {e}")
                    continue
                if session_id is not None:
                    started.append((session_id, autorun.id))
            await db.commit()

    for session_id, autorun_id in started:
        logger.warning(f"Autorun {autorun_id}: retried after boot as session {session_id}")
        await bus.emit(MirrorrEvent.SESSION_CREATED(id=session_id))
        await bus.emit(MirrorrEvent.AUTORUN_UPDATED(id=autorun_id))


def _content_folder(settings: MirrorrSettings, raw: Path | str | None) -> Path | None:
    """``raw`` as a folder we may remove, or ``None``.

    Only folders inside the content dir are ever touched, and the reserved
    ``autoruns``/``recordings`` roots are never touched themselves.
    """
    if not raw:
        return None
    target = Path(raw).resolve()
    try:
        rel = target.relative_to(settings.content_dir.resolve())
    except (ValueError, OSError):
        return None  # outside the content dir — not ours to manage
    if not rel.parts or target in {settings.autoruns_dir.resolve(), settings.recordings_dir.resolve()}:
        return None  # the content root itself, or a reserved tree
    return target


async def _kept_artifacts(settings: MirrorrSettings) -> list[Path]:
    """Every folder a kept recording's row still names."""
    async with _get_db_factory(settings) as db_factory:
        async with db_factory() as db:
            rows = (await db.exec(select(Recording.disk_path))).all()
    return [Path(raw).resolve() for raw in rows if raw]


async def remove_session_folder(
    settings: MirrorrSettings,
    session_folder: Path | str | None,
) -> None:
    """Remove a session's content folder and everything in it.

    A folder holding a kept recording's artifact is left alone — remux moves a
    finished session's folder under ``recordings/``, and that is not ours to
    remove.
    """
    target = _content_folder(settings, session_folder)
    if target is None:
        return
    if any(p == target or target in p.parents for p in await _kept_artifacts(settings)):
        return  # something kept lives in there

    await asyncio.to_thread(shutil.rmtree, target, True)


async def remove_recording_folder(
    settings: MirrorrSettings,
    disk_path: Path | str | None,
) -> None:
    """Remove a deleted recording's folder and everything in it.

    ``Recording.disk_path`` is the recording's own folder under ``recordings/``
    (``finalize`` moves the session folder there and names the row after it), so
    the media, the player shells and the logs go with it — the delete the
    console describes, which used to remove the row and leave the bytes.
    """
    target = _content_folder(settings, disk_path)
    if target is None or not target.is_dir():
        return
    if any(
        p == target or target in p.parents or p in target.parents
        for p in await _kept_artifacts(settings)
    ):
        return  # another recording still points at, in, or above it

    await asyncio.to_thread(shutil.rmtree, target, True)


async def delete_session(
    settings: MirrorrSettings,
    session_id: int,
    session_folder: Path | None = None,
    *,
    nc: NATS | None = None,
    autorun_id: int | None = None,
) -> None:
    """Delete session DB row + folder, emit SESSION_DELETED + AUTORUN_UPDATED.

    If the DB delete fails, the folder and events are NOT emitted — preventing
    data loss where the folder is deleted but the DB row remains.
    """
    from mirrorr.storage import crud
    from mirrorr.storage.enums import ResourceType
    from mirrorr.api.routers.crud import _cleanup_related_records

    # 1. Delete from DB first — if this fails, we don't touch the folder
    try:
        async with _get_db_factory(settings) as db_factory:
            async with db_factory() as db:
                # Same cleanup as the API delete path (_cascade_delete_session):
                # subscriptions, notifications and view grants all go with the row.
                await _cleanup_related_records(db, ResourceType.SESSION, session_id)
                await crud.delete(db, Session, session_id)
    except Exception as e:
        logger.error(f"Failed to delete session {session_id} from DB — folder preserved: {e}")
        return  # Abort: don't delete folder or emit events

    # 2. DB delete succeeded — now remove the folder
    await remove_session_folder(settings, session_folder)

    # 3. Emit events
    _nc = _resolve_nc(nc)
    if _nc is None:
        return

    try:
        await _nc.publish(
            MirrorrEvent.SESSION_DELETED.subject,
            MirrorrEvent.SESSION_DELETED(id=session_id).model_dump_json().encode(),
        )
        if autorun_id:
            await _nc.publish(
                MirrorrEvent.AUTORUN_UPDATED.subject,
                MirrorrEvent.AUTORUN_UPDATED(id=autorun_id).model_dump_json().encode(),
            )
    except Exception as e:
        logger.error(f"Failed to emit delete events for session {session_id}: {e}")


async def update_autorun(
    settings: MirrorrSettings,
    autorun_id: int,
    *,
    nc: NATS | None = None,
    **fields: Any,
) -> dict[str, tuple[Any, Any]]:
    """Generic autorun update: load → apply fields → diff → commit → emit.

    Returns the diff dict ``{field_name: (old_value, new_value)}`` for
    every field that actually changed.
    """
    from mirrorr.storage import crud

    if not fields:
        return {}

    diff: dict[str, tuple[Any, Any]] = {}
    try:
        async with _get_db_factory(settings) as db_factory:
            async with db_factory() as db:
                autorun = await crud.get_by_id(db, Autorun, autorun_id)
                if not autorun:
                    logger.warning(f"update_autorun: autorun {autorun_id} not found")
                    return {}

                for key, new_val in fields.items():
                    old_val = getattr(autorun, key, None)
                    if old_val != new_val:
                        diff[key] = (old_val, new_val)
                        setattr(autorun, key, new_val)

                if diff:
                    await crud.update(db, Autorun, autorun_id, autorun)
    except Exception as e:
        logger.error(f"Failed to update autorun {autorun_id}: {e}")
        raise  # Re-raise so callers can handle the failure

    if diff:
        _nc = _resolve_nc(nc)
        if _nc:
            try:
                await _nc.publish(
                    MirrorrEvent.AUTORUN_UPDATED.subject,
                    MirrorrEvent.AUTORUN_UPDATED(id=autorun_id).model_dump_json().encode(),
                )
            except Exception as e:
                logger.error(f"Failed to emit AUTORUN_UPDATED for autorun {autorun_id}: {e}")

    return diff


# ── Internal helpers ─────────────────────────────────────────────────

def _resolve_nc(nc: NATS | None) -> NATS | None:
    """Return *nc* if provided, otherwise fall back to the global bus."""
    if nc is not None:
        return nc
    try:
        from mirrorr.event_bus.nats import bus
        return bus.nc if bus.nc and bus.nc.is_connected else None
    except Exception:
        return None


async def _emit_session_diff(
    nc: NATS | None,
    session_id: int,
    diff: dict[str, tuple[Any, Any]],
    autorun_id: int | None,
) -> None:
    """Publish NATS events based on what changed in the session diff."""
    _nc = _resolve_nc(nc)
    if _nc is None:
        return

    try:
        # Always emit SESSION_UPDATED so WS clients get every change
        await _nc.publish(
            MirrorrEvent.SESSION_UPDATED.subject,
            MirrorrEvent.SESSION_UPDATED(id=session_id).model_dump_json().encode(),
        )

        # If status changed, emit lifecycle events + autorun update
        if "status" in diff:
            old_status, new_status = diff["status"]

            # Emit autorun update if we propagated
            if autorun_id:
                await _nc.publish(
                    MirrorrEvent.AUTORUN_UPDATED.subject,
                    MirrorrEvent.AUTORUN_UPDATED(id=autorun_id).model_dump_json().encode(),
                )

            # A recording session skips ACTIVE entirely, so STARTED belongs to
            # the first transition into either playing state.
            if new_status in (SessionStatus.ACTIVE, SessionStatus.RECORDING) and old_status not in (
                SessionStatus.ACTIVE,
                SessionStatus.RECORDING,
            ):
                await _nc.publish(
                    MirrorrEvent.SESSION_STARTED.subject,
                    MirrorrEvent.SESSION_STARTED(id=session_id).model_dump_json().encode(),
                )
            elif new_status == SessionStatus.COMPLETED:
                await _nc.publish(
                    MirrorrEvent.SESSION_STOPPED.subject,
                    MirrorrEvent.SESSION_STOPPED(id=session_id).model_dump_json().encode(),
                )
            elif new_status == SessionStatus.FAILED:
                await _nc.publish(
                    MirrorrEvent.SESSION_CRASHED.subject,
                    MirrorrEvent.SESSION_CRASHED(id=session_id).model_dump_json().encode(),
                )
    except Exception as e:
        logger.opt(colors=True).error(
            f"Failed to emit NATS events for session <green>{session_id}</green>: {e}"
        )