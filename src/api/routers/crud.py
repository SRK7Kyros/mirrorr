from __future__ import annotations

import json
from datetime import datetime

from sqlalchemy.exc import IntegrityError
from loguru import logger
from src.event_bus.nats import bus, get_control_nc
from src.event_bus.event import MirrorrEvent, BaseEvent
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Body, Query
from sqlmodel import SQLModel, select
from sqlmodel.ext.asyncio.session import AsyncSession
from src.api.dependencies import _get_db_session, require_auth, AuthState
from src.api.auth import subscribe_requester
from src.api.schemas import (
    CreateSessionRequest,
    CreateAutorunRequest,
    UpdateAutorunRequest,
    CreateProfileRequest,
    UpdateProfileRequest,
    SaveProfileRequest,
    SessionResponse,
    AutorunResponse,
    RecordingResponse,
    ProfileResponse,
    EngineResponse,
    ResolverResponse,
)
from src.storage.models import Session, Autorun, Recording, Profile, Engine, Resolver
from src.storage.enums import SessionStatus, ResourceType
from src.storage import crud
from src.storage.models import EventSubscription, Notification

crud_routers = APIRouter()


async def _cleanup_related_records(db: AsyncSession, resource_type: str, resource_id: int) -> None:
    """Clean up EventSubscription and Notification records for a deleted entity."""
    from sqlmodel import delete as sql_delete
    await db.exec(
        sql_delete(EventSubscription).where(
            EventSubscription.resource_type == resource_type,
            EventSubscription.resource_id == resource_id,
        )
    )
    await db.exec(
        sql_delete(Notification).where(
            Notification.resource_type == resource_type,
            Notification.resource_id == resource_id,
        )
    )
    await db.flush()


def _require_owner_or_admin(auth: AuthState, obj) -> bool:
    """Check ownership or admin status. Raises 401/403 if not authorized."""
    if auth.is_admin:
        return True
    if not auth.user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return getattr(obj, "requester_user_token", None) == auth.user.username


async def _safe_emit(event: BaseEvent) -> None:
    """Emit a NATS event, logging but not raising on failure.

    The DB write already committed — a failed emit should not crash the
    HTTP request.  The WS cache will refresh on the next user action.
    """
    try:
        await bus.emit(event)
    except Exception as e:  # noqa: broad-except — NATS failure must not crash HTTP requests
        logger.warning(f"Failed to emit {event.subject} (id={getattr(event, 'id', '?')}): {e}")


async def _safe_delete(db: AsyncSession, model: type, id: int) -> None:
    """Delete via CRUD, raising 404 if the entity vanished mid-request."""
    try:
        await crud.delete(db, model, id)
    except ValueError:
        raise HTTPException(status_code=404, detail=f"{model.__name__} {id} not found")
    except IntegrityError:
        # Let the global IntegrityError handler produce the response
        raise


# ── Sessions ──────────────────────────────────────────────────────────

sessions_router = APIRouter(prefix="/sessions")


@sessions_router.get("/")
async def get_all_sessions(
    db: AsyncSession = Depends(_get_db_session),
    auth: AuthState = Depends(require_auth),
    cursor: int | None = Query(None, description="ID of last item from previous page"),
    limit: int = Query(50, ge=1, le=200, description="Items per page"),
):
    if auth.is_admin:
        result = await crud.get_all_paginated(db, Session, cursor=cursor, limit=limit)
    else:
        stmt = select(Session).where(Session.requester_user_token == auth.user.username)
        if cursor is not None:
            stmt = stmt.where(Session.id < cursor)
        stmt = stmt.order_by(Session.id.desc()).limit(limit + 1)
        items = list((await db.exec(stmt)).all())
        has_more = len(items) > limit
        if has_more:
            items = items[:limit]
        result = crud.PaginatedResult(
            items=items,
            next_cursor=items[-1].id if has_more and items else None,
            has_more=has_more,
        )
    return {
        "items": result.items,
        "next_cursor": result.next_cursor,
        "has_more": result.has_more,
    }


@sessions_router.get("/{id}", response_model=SessionResponse)
async def get_session(id: int, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    item = await crud.get_by_id(db, Session, id)
    if not item:
        raise HTTPException(status_code=404, detail="Session not found")
    if not _require_owner_or_admin(auth, item):
        raise HTTPException(status_code=403, detail="Not your session")
    return item


@sessions_router.post("/", response_model=SessionResponse)
async def create_session(item: CreateSessionRequest, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    # Validate FK references exist
    engine = await crud.get_by_id(db, Engine, item.engine_id)
    if not engine:
        raise HTTPException(status_code=400, detail=f"Engine {item.engine_id} not found")
    resolver = await crud.get_by_id(db, Resolver, item.resolver_id)
    if not resolver:
        raise HTTPException(status_code=400, detail=f"Resolver {item.resolver_id} not found")
    if item.profile_id is not None:
        profile = await crud.get_by_id(db, Profile, item.profile_id)
        if not profile:
            raise HTTPException(status_code=400, detail=f"Profile {item.profile_id} not found")
    payload = Session(
        profile_id=item.profile_id,
        engine_id=item.engine_id,
        resolver_id=item.resolver_id,
        resolver_config=item.resolver_config,
        retry_mode=item.retry_mode,
        retry_config=item.retry_config,
        recording=item.recording,
        requester_user_token=auth.user.username if auth.user else "",
    )
    try:
        obj = await crud.create(db, payload)
    except IntegrityError as e:
        raise HTTPException(status_code=400, detail="A resource with that name already exists.")
    await subscribe_requester(db, payload.requester_user_token, ResourceType.SESSION, obj.id)
    await _safe_emit(MirrorrEvent.SESSION_CREATED(id=obj.id))
    return obj


@sessions_router.delete("/{id}", status_code=204)
async def delete_session(id: int, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    obj = await crud.get_by_id(db, Session, id)
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    if not _require_owner_or_admin(auth, obj):
        raise HTTPException(status_code=403, detail="Not your session")
    if obj.status == SessionStatus.REMUXING:
        raise HTTPException(status_code=409, detail="Session is remuxing. Wait for it to complete or fail before deleting.")
    if obj.status in (SessionStatus.ACTIVE, SessionStatus.RECORDING):
        try:
            return await _send_control(id, "stop")
        except HTTPException as e:
            if e.status_code == 504:
                await _cleanup_related_records(db, ResourceType.SESSION, id)
                await _safe_delete(db, Session, id)
                await _safe_emit(MirrorrEvent.SESSION_DELETED(id=id))
                return None
            raise
    await _cleanup_related_records(db, ResourceType.SESSION, id)
    await _safe_delete(db, Session, id)
    await _safe_emit(MirrorrEvent.SESSION_DELETED(id=id))


crud_routers.include_router(sessions_router)

# ── Autoruns ───────────────────────────────────────────────────────────

autoruns_router = APIRouter(prefix="/autoruns")


@autoruns_router.get("/")
async def get_all_autoruns(
    db: AsyncSession = Depends(_get_db_session),
    auth: AuthState = Depends(require_auth),
    cursor: int | None = Query(None, description="ID of last item from previous page"),
    limit: int = Query(50, ge=1, le=200, description="Items per page"),
):
    if auth.is_admin:
        result = await crud.get_all_paginated(db, Autorun, cursor=cursor, limit=limit)
    else:
        stmt = select(Autorun).where(Autorun.requester_user_token == auth.user.username)
        if cursor is not None:
            stmt = stmt.where(Autorun.id < cursor)
        stmt = stmt.order_by(Autorun.id.desc()).limit(limit + 1)
        items = list((await db.exec(stmt)).all())
        has_more = len(items) > limit
        if has_more:
            items = items[:limit]
        result = crud.PaginatedResult(
            items=items,
            next_cursor=items[-1].id if has_more and items else None,
            has_more=has_more,
        )
    return {
        "items": result.items,
        "next_cursor": result.next_cursor,
        "has_more": result.has_more,
    }


@autoruns_router.get("/{id}", response_model=AutorunResponse)
async def get_autorun(id: int, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    item = await crud.get_by_id(db, Autorun, id)
    if not item:
        raise HTTPException(status_code=404, detail="Autorun not found")
    if not _require_owner_or_admin(auth, item):
        raise HTTPException(status_code=403, detail="Not your autorun")
    return item


@autoruns_router.post("/", response_model=AutorunResponse)
async def create_autorun(item: CreateAutorunRequest, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    # Validate FK references exist
    engine = await crud.get_by_id(db, Engine, item.engine_id)
    if not engine:
        raise HTTPException(status_code=400, detail=f"Engine {item.engine_id} not found")
    resolver = await crud.get_by_id(db, Resolver, item.resolver_id)
    if not resolver:
        raise HTTPException(status_code=400, detail=f"Resolver {item.resolver_id} not found")
    if item.profile_id is not None:
        profile = await crud.get_by_id(db, Profile, item.profile_id)
        if not profile:
            raise HTTPException(status_code=400, detail=f"Profile {item.profile_id} not found")
    payload = Autorun(
        user_friendly_name=item.user_friendly_name,
        snake_case_name=item.snake_case_name,
        profile_id=item.profile_id,
        engine_id=item.engine_id,
        resolver_id=item.resolver_id,
        resolver_config=item.resolver_config,
        retry_mode=item.retry_mode,
        retry_config=item.retry_config,
        start_time=item.start_time.replace(tzinfo=None) if item.start_time.tzinfo else item.start_time,
        end_time=item.end_time.replace(tzinfo=None) if item.end_time.tzinfo else item.end_time,
        recording=item.recording,
        requester_user_token=auth.user.username if auth.user else "",
    )
    try:
        obj = await crud.create(db, payload)
    except IntegrityError as e:
        raise HTTPException(status_code=400, detail="A resource with that name already exists.")
    await subscribe_requester(db, payload.requester_user_token, ResourceType.AUTORUN, obj.id)
    await _safe_emit(MirrorrEvent.AUTORUN_CREATED(id=obj.id))
    return obj


@autoruns_router.put("/{id}", response_model=AutorunResponse)
async def update_autorun(id: int, item: UpdateAutorunRequest, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    existing = await crud.get_by_id(db, Autorun, id)
    if not existing:
        raise HTTPException(status_code=404, detail="Autorun not found")
    if not _require_owner_or_admin(auth, existing):
        raise HTTPException(status_code=403, detail="Not your autorun")
    payload_data = item.model_dump(exclude_unset=True)
    if "start_time" in payload_data and payload_data["start_time"] is not None:
        payload_data["start_time"] = payload_data["start_time"].replace(tzinfo=None) if payload_data["start_time"].tzinfo else payload_data["start_time"]
    if "end_time" in payload_data and payload_data["end_time"] is not None:
        payload_data["end_time"] = payload_data["end_time"].replace(tzinfo=None) if payload_data["end_time"].tzinfo else payload_data["end_time"]
    payload = Autorun.model_validate({**existing.model_dump(), **payload_data})
    if not payload.requester_user_token:
        if not auth.user:
            raise HTTPException(status_code=401, detail="Not authenticated")
        payload.requester_user_token = auth.user.username
    try:
        obj = await crud.update(db, Autorun, id, payload)
    except ValueError:
        raise HTTPException(status_code=404, detail="Autorun not found")
    except IntegrityError as e:
        raise HTTPException(status_code=400, detail="A resource with that name already exists.")
    await subscribe_requester(db, payload.requester_user_token, ResourceType.AUTORUN, id)
    await _safe_emit(MirrorrEvent.AUTORUN_UPDATED(id=id))
    return obj


@autoruns_router.delete("/{id}", status_code=204)
async def delete_autorun(id: int, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    obj = await crud.get_by_id(db, Autorun, id)
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    if not _require_owner_or_admin(auth, obj):
        raise HTTPException(status_code=403, detail="Not your autorun")
    await _cleanup_related_records(db, ResourceType.AUTORUN, id)
    await _safe_delete(db, Autorun, id)
    await _safe_emit(MirrorrEvent.AUTORUN_DELETED(id=id))

async def _create_profile_from_entity(
    db: AsyncSession,
    auth: AuthState,
    name: str,
    engine_id: int,
    resolver_id: int,
    resolver_config: dict,
    retry_mode: str,
    retry_config: dict,
) -> Profile:
    """Create a Profile from an existing entity's fields (session or autorun)."""
    profile = Profile(
        name=name,
        default_engine_id=engine_id,
        resolver_id=resolver_id,
        resolver_config=resolver_config,
        retry_mode=retry_mode,
        retry_config=retry_config,
        requester_user_token=auth.user.username if auth.user else "",
    )
    db.add(profile)
    await db.commit()
    await db.refresh(profile)
    await subscribe_requester(db, profile.requester_user_token, ResourceType.PROFILE, profile.id)
    await _safe_emit(MirrorrEvent.PROFILE_CREATED(id=profile.id))
    return profile


# ── Save Autorun as Profile ────────────────────────────────────────────


@crud_routers.post("/autoruns/{autorun_id}/save-as-profile")
async def save_autorun_as_profile(autorun_id: int, req: SaveProfileRequest, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    autorun = await crud.get_by_id(db, Autorun, autorun_id)
    if not autorun:
        raise HTTPException(status_code=404, detail="Autorun not found")
    if not _require_owner_or_admin(auth, autorun):
        raise HTTPException(status_code=403, detail="Not your autorun")
    return await _create_profile_from_entity(
        db, auth, req.name,
        autorun.engine_id, autorun.resolver_id, autorun.resolver_config,
        autorun.retry_mode, autorun.retry_config,
    )


crud_routers.include_router(autoruns_router)

# ── Save Session as Profile ────────────────────────────────────────────


@crud_routers.post("/sessions/{session_id}/save-as-profile")
async def save_session_as_profile(session_id: int, req: SaveProfileRequest, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    session = await crud.get_by_id(db, Session, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if not _require_owner_or_admin(auth, session):
        raise HTTPException(status_code=403, detail="Not your session")
    return await _create_profile_from_entity(
        db, auth, req.name,
        session.engine_id, session.resolver_id, session.resolver_config,
        session.retry_mode, session.retry_config,
    )


# ── Recordings ─────────────────────────────────────────────────────────

recordings_router = APIRouter(prefix="/recordings")


@recordings_router.get("/")
async def get_all_recordings(
    db: AsyncSession = Depends(_get_db_session),
    auth: AuthState = Depends(require_auth),
    cursor: int | None = Query(None, description="ID of last item from previous page"),
    limit: int = Query(50, ge=1, le=200, description="Items per page"),
):
    if auth.is_admin:
        result = await crud.get_all_paginated(db, Recording, cursor=cursor, limit=limit)
    else:
        stmt = select(Recording).where(Recording.requester_user_token == auth.user.username)
        if cursor is not None:
            stmt = stmt.where(Recording.id < cursor)
        stmt = stmt.order_by(Recording.id.desc()).limit(limit + 1)
        items = list((await db.exec(stmt)).all())
        has_more = len(items) > limit
        if has_more:
            items = items[:limit]
        result = crud.PaginatedResult(
            items=items,
            next_cursor=items[-1].id if has_more and items else None,
            has_more=has_more,
        )
    return {
        "items": result.items,
        "next_cursor": result.next_cursor,
        "has_more": result.has_more,
    }


@recordings_router.get("/{id}", response_model=RecordingResponse)
async def get_recording(id: int, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    item = await crud.get_by_id(db, Recording, id)
    if not item:
        raise HTTPException(status_code=404, detail="Recording not found")
    if not _require_owner_or_admin(auth, item):
        raise HTTPException(status_code=403, detail="Not your recording")
    return item


@recordings_router.delete("/{id}", status_code=204)
async def delete_recording(id: int, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    obj = await crud.get_by_id(db, Recording, id)
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    if not _require_owner_or_admin(auth, obj):
        raise HTTPException(status_code=403, detail="Not your recording")

    await _cleanup_related_records(db, ResourceType.RECORDING, id)
    await _safe_delete(db, Recording, id)
    await _safe_emit(MirrorrEvent.RECORDING_DELETED(id=id))


crud_routers.include_router(recordings_router)

# ── Profiles ───────────────────────────────────────────────────────────

profiles_router = APIRouter(prefix="/profiles")


@profiles_router.get("/")
async def get_all_profiles(
    db: AsyncSession = Depends(_get_db_session),
    auth: AuthState = Depends(require_auth),
    cursor: int | None = Query(None, description="ID of last item from previous page"),
    limit: int = Query(50, ge=1, le=200, description="Items per page"),
):
    if auth.is_admin:
        result = await crud.get_all_paginated(db, Profile, cursor=cursor, limit=limit)
    else:
        stmt = select(Profile).where(Profile.requester_user_token == auth.user.username)
        if cursor is not None:
            stmt = stmt.where(Profile.id < cursor)
        stmt = stmt.order_by(Profile.id.desc()).limit(limit + 1)
        items = list((await db.exec(stmt)).all())
        has_more = len(items) > limit
        if has_more:
            items = items[:limit]
        result = crud.PaginatedResult(
            items=items,
            next_cursor=items[-1].id if has_more and items else None,
            has_more=has_more,
        )
    return {
        "items": result.items,
        "next_cursor": result.next_cursor,
        "has_more": result.has_more,
    }


@profiles_router.get("/{id}", response_model=ProfileResponse)
async def get_profile(id: int, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    item = await crud.get_by_id(db, Profile, id)
    if not item:
        raise HTTPException(status_code=404, detail="Profile not found")
    if not _require_owner_or_admin(auth, item):
        raise HTTPException(status_code=403, detail="Not your profile")
    return item


@profiles_router.post("/", response_model=ProfileResponse)
async def create_profile(item: CreateProfileRequest, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    # Validate FK references exist
    engine = await crud.get_by_id(db, Engine, item.default_engine_id)
    if not engine:
        raise HTTPException(status_code=400, detail=f"Engine {item.default_engine_id} not found")
    resolver = await crud.get_by_id(db, Resolver, item.resolver_id)
    if not resolver:
        raise HTTPException(status_code=400, detail=f"Resolver {item.resolver_id} not found")

    payload = Profile.model_validate(item.model_dump())
    if not auth.user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload.requester_user_token = auth.user.username
    try:
        obj = await crud.create(db, payload)
    except IntegrityError as e:
        raise HTTPException(status_code=400, detail="A resource with that name already exists.")
    await subscribe_requester(db, payload.requester_user_token, ResourceType.PROFILE, obj.id)
    await _safe_emit(MirrorrEvent.PROFILE_CREATED(id=obj.id))
    return obj


@profiles_router.put("/{id}", response_model=ProfileResponse)
async def update_profile(id: int, item: UpdateProfileRequest, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    existing = await crud.get_by_id(db, Profile, id)
    if not existing:
        raise HTTPException(status_code=404, detail="Profile not found")
    if not _require_owner_or_admin(auth, existing):
        raise HTTPException(status_code=403, detail="Not your profile")
    payload_data = item.model_dump(exclude_unset=True)
    payload = Profile.model_validate({**existing.model_dump(), **payload_data})
    if not auth.user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload.requester_user_token = auth.user.username
    try:
        obj = await crud.update(db, Profile, id, payload)
    except ValueError:
        raise HTTPException(status_code=404, detail="Profile not found")
    except IntegrityError as e:
        raise HTTPException(status_code=400, detail="A resource with that name already exists.")
    await subscribe_requester(db, payload.requester_user_token, ResourceType.PROFILE, id)
    await _safe_emit(MirrorrEvent.PROFILE_UPDATED(id=id))
    return obj


@profiles_router.delete("/{id}", status_code=204)
async def delete_profile(id: int, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    obj = await crud.get_by_id(db, Profile, id)
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    if not _require_owner_or_admin(auth, obj):
        raise HTTPException(status_code=403, detail="Not your profile")
    await _cleanup_related_records(db, ResourceType.PROFILE, id)
    await _safe_delete(db, Profile, id)
    await _safe_emit(MirrorrEvent.PROFILE_DELETED(id=id))


crud_routers.include_router(profiles_router)

# ── Engines ────────────────────────────────────────────────────────────

engines_router = APIRouter(prefix="/engines")


@engines_router.get("/")
async def get_all_engines(
    db: AsyncSession = Depends(_get_db_session),
    _auth: AuthState = Depends(require_auth),
    cursor: int | None = Query(None, description="ID of last item from previous page"),
    limit: int = Query(50, ge=1, le=200, description="Items per page"),
):
    result = await crud.get_all_paginated(db, Engine, cursor=cursor, limit=limit)
    return {
        "items": result.items,
        "next_cursor": result.next_cursor,
        "has_more": result.has_more,
    }


@engines_router.get("/{id}", response_model=EngineResponse)
async def get_engine(id: int, db: AsyncSession = Depends(_get_db_session), _auth: AuthState = Depends(require_auth)):
    item = await crud.get_by_id(db, Engine, id)
    if not item:
        raise HTTPException(status_code=404, detail="Engine not found")
    return item


crud_routers.include_router(engines_router)

# ── Resolvers ──────────────────────────────────────────────────────────

resolvers_router = APIRouter(prefix="/resolvers")


@resolvers_router.get("/")
async def get_all_resolvers(
    db: AsyncSession = Depends(_get_db_session),
    _auth: AuthState = Depends(require_auth),
    cursor: int | None = Query(None, description="ID of last item from previous page"),
    limit: int = Query(50, ge=1, le=200, description="Items per page"),
):
    result = await crud.get_all_paginated(db, Resolver, cursor=cursor, limit=limit)
    return {
        "items": result.items,
        "next_cursor": result.next_cursor,
        "has_more": result.has_more,
    }


@resolvers_router.get("/{id}", response_model=ResolverResponse)
async def get_resolver(id: int, db: AsyncSession = Depends(_get_db_session), _auth: AuthState = Depends(require_auth)):
    item = await crud.get_by_id(db, Resolver, id)
    if not item:
        raise HTTPException(status_code=404, detail="Resolver not found")
    return item


crud_routers.include_router(resolvers_router)

# ── Session control ────────────────────────────────────────────────────

session_control_router = APIRouter(prefix="/sessions")




async def _send_control(session_id: int, command: str, timeout: float = 5.0) -> dict:
    """Send a control command to a running session supervisor via NATS.

    Uses a dedicated NATS connection (_control_nc) rather than bus.nc, because
    bus.nc has a ">" wildcard subscription (WS events handler) that intercepts
    inbox reply messages before the request() future can resolve.
    """
    from asyncio import TimeoutError as _TimeoutError

    event = MirrorrEvent.SESSION_STOP_REQUESTED(id=session_id, command=command)
    try:
        nc = await get_control_nc()
        msg = await nc.request(
            f"session.{session_id}.control",
            event.model_dump_json().encode(),
            timeout=timeout,
        )
        reply = json.loads(msg.data.decode())
    except _TimeoutError:
        raise HTTPException(status_code=504, detail=f"Session supervisor {session_id} is not responding")
    except Exception as e:
        logger.error(f"Control command '{command}' failed for session {session_id}: {type(e).__name__}: {e}")
        raise HTTPException(status_code=502, detail="Session control command failed")

    if "error" in reply:
        raise HTTPException(status_code=400, detail=reply["error"])
    return reply


async def _require_session_owner(session_id: int, auth: AuthState, db: AsyncSession) -> Session:
    obj = await crud.get_by_id(db, Session, session_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Session not found")
    if not _require_owner_or_admin(auth, obj):
        raise HTTPException(status_code=403, detail="Not your session")
    return obj


@session_control_router.post("/{session_id}/stop")
async def stop_session(session_id: int, auth: AuthState = Depends(require_auth), db: AsyncSession = Depends(_get_db_session)):
    await _require_session_owner(session_id, auth, db)
    return await _send_control(session_id, "stop")


@session_control_router.post("/{session_id}/recording/enable")
async def enable_recording(session_id: int, auth: AuthState = Depends(require_auth), db: AsyncSession = Depends(_get_db_session)):
    await _require_session_owner(session_id, auth, db)
    return await _send_control(session_id, "enable_recording")


@session_control_router.post("/{session_id}/recording/disable")
async def disable_recording(session_id: int, auth: AuthState = Depends(require_auth), db: AsyncSession = Depends(_get_db_session)):
    await _require_session_owner(session_id, auth, db)
    return await _send_control(session_id, "disable_recording")
