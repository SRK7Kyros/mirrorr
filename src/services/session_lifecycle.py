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
- Main process: uses the DI container's shared session_factory
- Subprocess (supervisor): falls back to creating a fresh engine from settings

Usage:
    from src.services.session_lifecycle import update_session, delete_session, update_autorun

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

import contextlib
import shutil
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, TYPE_CHECKING

from loguru import logger
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlmodel.ext.asyncio.session import AsyncSession

from src.event_bus.event import MirrorrEvent
from src.storage.models import (
    Autorun,
    AutorunStatus,
    Session,
    SessionStatus,
)

if TYPE_CHECKING:
    from nats.aio.client import Client as NATS
    from src.startup.config import MirrorrSettings


# ── Status mapping: Session → Autorun ────────────────────────────────

_STATUS_MAP: dict[SessionStatus, AutorunStatus] = {
    SessionStatus.ACTIVE: AutorunStatus.ACTIVE,
    SessionStatus.RECORDING: AutorunStatus.RECORDING,
    SessionStatus.TERMINATING: AutorunStatus.TERMINATING,
    SessionStatus.REMUXING: AutorunStatus.REMUXING,
    SessionStatus.FINALIZING: AutorunStatus.FINALIZING,
    SessionStatus.COMPLETED: AutorunStatus.COMPLETED,
    SessionStatus.FAILED: AutorunStatus.FAILED,
}


@asynccontextmanager
async def _get_session_factory(
    settings: MirrorrSettings | None = None,
) -> AsyncGenerator[async_sessionmaker, None]:
    """Get a session factory, preferring the DI container.

    In the main process, the DI container holds a shared factory.
    In subprocesses (supervisor), the container isn't wired, so we
    create a fresh engine from settings and dispose it when done.
    """
    # Try DI container first (main process)
    try:
        from src.di import container
        yield container.session_factory
        return
    except (RuntimeError, ImportError):
        pass

    # Fallback: create engine from settings (subprocess)
    if settings is None:
        raise RuntimeError("No DI container and no settings — cannot get session factory")
    from src.storage.database import create_db_engine
    db_engine, session_factory = create_db_engine(settings)
    try:
        yield session_factory
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
    from src.storage import crud

    if not fields:
        return {}

    diff: dict[str, tuple[Any, Any]] = {}
    autorun_id: int | None = None
    try:
        async with _get_session_factory(settings) as session_factory:
            async with session_factory() as db:
                session = await crud.get_by_id(db, Session, session_id)
                if not session:
                    logger.warning(f"update_session: session {session_id} not found")
                    return {}

                # ── Compute diff and apply ───────────────────────────────
                for key, new_val in fields.items():
                    old_val = getattr(session, key, None)
                    if old_val != new_val:
                        diff[key] = (old_val, new_val)
                        setattr(session, key, new_val)

                # ── Auto-set timestamps based on status transitions ──────
                if "status" in diff:
                    new_status = diff["status"][1]

                    # Set started_at when transitioning to an active state
                    if new_status in (SessionStatus.ACTIVE, SessionStatus.RECORDING):
                        if not session.started_at:
                            session.started_at = datetime.now(timezone.utc).replace(tzinfo=None)
                            diff["started_at"] = (None, session.started_at)

                    # Set ended_at when reaching a terminal state
                    if new_status in (SessionStatus.COMPLETED, SessionStatus.FAILED):
                        if not session.ended_at:
                            session.ended_at = datetime.now(timezone.utc).replace(tzinfo=None)
                            diff["ended_at"] = (None, session.ended_at)

                # ── Commit ───────────────────────────────────────────────
                if diff:
                    await crud.update(db, Session, session_id, session)

                    # ── Propagate status to autorun ──────────────────────
                    if "status" in diff and session.autorun_id:
                        autorun = await crud.get_by_id(db, Autorun, session.autorun_id)
                        if autorun:
                            new_status = diff["status"][1]
                            mapped = _STATUS_MAP.get(new_status)
                            if mapped and autorun.status != mapped:
                                autorun.status = mapped
                                await crud.update(db, Autorun, autorun.id, autorun)
                                autorun_id = autorun.id
    except Exception as e:
        logger.error(f"Failed to update session {session_id}: {e}")

    # ── Emit NATS events based on diff ────────────────────────────────
    if diff:
        await _emit_session_diff(nc, session_id, diff, autorun_id)

    return diff


async def delete_session(
    settings: MirrorrSettings,
    session_id: int,
    session_folder: Path | None = None,
    *,
    nc: NATS | None = None,
    autorun_id: int | None = None,
) -> None:
    """Delete session DB row + folder, emit SESSION_DELETED + AUTORUN_UPDATED."""
    from src.storage import crud

    try:
        async with _get_session_factory(settings) as session_factory:
            async with session_factory() as db:
                await crud.delete(db, Session, session_id)
    except Exception as e:
        logger.error(f"Failed to delete session {session_id}: {e}")

    if session_folder and session_folder.exists():
        shutil.rmtree(session_folder, ignore_errors=True)

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
    from src.storage import crud

    if not fields:
        return {}

    diff: dict[str, tuple[Any, Any]] = {}
    try:
        async with _get_session_factory(settings) as session_factory:
            async with session_factory() as db:
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
        from src.event_bus.nats import bus
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
            new_status = diff["status"][1]

            # Emit autorun update if we propagated
            if autorun_id:
                await _nc.publish(
                    MirrorrEvent.AUTORUN_UPDATED.subject,
                    MirrorrEvent.AUTORUN_UPDATED(id=autorun_id).model_dump_json().encode(),
                )

            # Lifecycle-specific events
            if new_status == SessionStatus.ACTIVE:
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