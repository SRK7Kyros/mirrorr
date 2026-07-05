from datetime import datetime

from sqlalchemy.exc import IntegrityError
from loguru import logger
from src.event_bus.nats import bus
from src.event_bus.event import MirrorrEvent, BaseEvent
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Body
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
)
from src.storage.models import Session, Autorun, Recording, Profile, Engine, Resolver, SessionStatus, ResourceType
from src.storage import crud

event_map: dict[type, tuple[type, type, type]] = {
    Session: (MirrorrEvent.SESSION_CREATED, MirrorrEvent.SESSION_UPDATED, MirrorrEvent.SESSION_DELETED),
    Autorun: (MirrorrEvent.AUTORUN_CREATED, MirrorrEvent.AUTORUN_UPDATED, MirrorrEvent.AUTORUN_DELETED),
    Recording: (MirrorrEvent.RECORDING_CREATED, MirrorrEvent.RECORDING_UPDATED, MirrorrEvent.RECORDING_DELETED),
    Profile: (MirrorrEvent.PROFILE_CREATED, MirrorrEvent.PROFILE_UPDATED, MirrorrEvent.PROFILE_DELETED),
}

protected_fields: dict[type, list[str]] = {
    Session: ["status", "recording", "retry_attempts", "started_at", "ended_at"],
}

crud_routers = APIRouter()


def _is_owner_or_admin(auth: AuthState, obj) -> bool:
    if auth.is_admin:
        return True
    assert auth.user is not None
    return getattr(obj, "requester_user_token", None) == auth.user.username


async def _safe_emit(event: BaseEvent) -> None:
    """Emit a NATS event, logging but not raising on failure.

    The DB write already committed — a failed emit should not crash the
    HTTP request.  The WS cache will refresh on the next user action.
    """
    try:
        await bus.emit(event)
    except Exception as e:
        logger.warning(f"Failed to emit {event.subject} (id={getattr(event, 'id', '?')}): {e}")


async def _safe_delete(db: AsyncSession, model: type, id: int) -> None:
    """Delete via CRUD, raising 404 if the entity vanished mid-request."""
    try:
        await crud.delete(db, model, id)
    except ValueError:
        raise HTTPException(status_code=404, detail=f"{model.__name__} {id} not found")


# ── Sessions ──────────────────────────────────────────────────────────

sessions_router = APIRouter(prefix="/sessions")


@sessions_router.get("/")
async def get_all_sessions(db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    assert auth.user is not None
    if auth.is_admin:
        return await crud.get_all(db, Session)
    stmt = select(Session).where(Session.requester_user_token == auth.user.username)
    result = await db.exec(stmt)
    return list(result.all())


@sessions_router.get("/{id}")
async def get_session(id: int, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    item = await crud.get_by_id(db, Session, id)
    if not item:
        raise HTTPException(status_code=404, detail="Session not found")
    if not _is_owner_or_admin(auth, item):
        raise HTTPException(status_code=403, detail="Not your session")
    return item


@sessions_router.post("/")
async def create_session(item: CreateSessionRequest, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    payload = Session(
        profile_id=item.profile_id,
        engine_id=item.engine_id,
        resolver_id=item.resolver_id,
        resolver_config=item.resolver_config,
        retry_mode=item.retry_mode,
        retry_config=item.retry_config,
        recording=item.recording,
        requester_user_token=item.requester_user_token or (auth.user.username if auth.user else ""),
    )
    try:
        obj = await crud.create(db, payload)
    except IntegrityError as e:
        raise HTTPException(status_code=400, detail=f"Database integrity error: {e.orig}")
    await subscribe_requester(db, payload.requester_user_token, ResourceType.SESSION, obj.id)
    await _safe_emit(MirrorrEvent.SESSION_CREATED(id=obj.id))
    return obj


@sessions_router.delete("/{id}")
async def delete_session(id: int, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    obj = await crud.get_by_id(db, Session, id)
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    if not _is_owner_or_admin(auth, obj):
        raise HTTPException(status_code=403, detail="Not your session")
    if obj.status == SessionStatus.REMUXING:
        raise HTTPException(status_code=409, detail="Session is remuxing. Wait for it to complete or fail before deleting.")
    if obj.status in (SessionStatus.ACTIVE, SessionStatus.RECORDING):
        try:
            return await _send_control(id, "stop")
        except HTTPException as e:
            if e.status_code == 504:
                await _safe_delete(db, Session, id)
                await _safe_emit(MirrorrEvent.SESSION_DELETED(id=id))
                return {"status": "orphan_cleaned", "session_id": id}
            raise
    await _safe_delete(db, Session, id)
    await _safe_emit(MirrorrEvent.SESSION_DELETED(id=id))


crud_routers.include_router(sessions_router)

# ── Autoruns ───────────────────────────────────────────────────────────

autoruns_router = APIRouter(prefix="/autoruns")


@autoruns_router.get("/")
async def get_all_autoruns(db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    assert auth.user is not None
    if auth.is_admin:
        return await crud.get_all(db, Autorun)
    stmt = select(Autorun).where(Autorun.requester_user_token == auth.user.username)
    result = await db.exec(stmt)
    return list(result.all())


@autoruns_router.get("/{id}")
async def get_autorun(id: int, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    item = await crud.get_by_id(db, Autorun, id)
    if not item:
        raise HTTPException(status_code=404, detail="Autorun not found")
    if not _is_owner_or_admin(auth, item):
        raise HTTPException(status_code=403, detail="Not your autorun")
    return item


def _parse_datetimes(item: dict[str, Any], fields: list[str]) -> dict[str, Any]:
    """Parse ISO datetime strings into naive UTC datetime objects for SQLAlchemy."""
    for f in fields:
        if f in item and isinstance(item[f], str):
            # Convert to aware UTC, then strip tzinfo for SQLite compatibility
            item[f] = datetime.fromisoformat(item[f].replace("Z", "+00:00")).replace(tzinfo=None)
    return item


@autoruns_router.post("/")
async def create_autorun(item: CreateAutorunRequest, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
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
        requester_user_token=item.requester_user_token or (auth.user.username if auth.user else ""),
    )
    try:
        obj = await crud.create(db, payload)
    except IntegrityError as e:
        raise HTTPException(status_code=400, detail=f"Database integrity error: {e.orig}")
    await subscribe_requester(db, payload.requester_user_token, ResourceType.AUTORUN, obj.id)
    await _safe_emit(MirrorrEvent.AUTORUN_CREATED(id=obj.id))
    return obj


@autoruns_router.put("/{id}")
async def update_autorun(id: int, item: UpdateAutorunRequest, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    existing = await crud.get_by_id(db, Autorun, id)
    if not existing:
        raise HTTPException(status_code=404, detail="Autorun not found")
    if not _is_owner_or_admin(auth, existing):
        raise HTTPException(status_code=403, detail="Not your autorun")
    payload_data = item.model_dump(exclude_unset=True)
    if "start_time" in payload_data and payload_data["start_time"] is not None:
        payload_data["start_time"] = payload_data["start_time"].replace(tzinfo=None) if payload_data["start_time"].tzinfo else payload_data["start_time"]
    if "end_time" in payload_data and payload_data["end_time"] is not None:
        payload_data["end_time"] = payload_data["end_time"].replace(tzinfo=None) if payload_data["end_time"].tzinfo else payload_data["end_time"]
    payload = Autorun.model_validate({**existing.model_dump(), **payload_data})
    if not payload.requester_user_token:
        assert auth.user is not None
        payload.requester_user_token = auth.user.username
    try:
        obj = await crud.update(db, Autorun, id, payload)
    except ValueError:
        raise HTTPException(status_code=404, detail="Autorun not found")
    except IntegrityError as e:
        raise HTTPException(status_code=400, detail=f"Database integrity error: {e.orig}")
    await subscribe_requester(db, payload.requester_user_token, ResourceType.AUTORUN, id)
    await _safe_emit(MirrorrEvent.AUTORUN_UPDATED(id=id))
    return obj


@autoruns_router.delete("/{id}")
async def delete_autorun(id: int, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    obj = await crud.get_by_id(db, Autorun, id)
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    if not _is_owner_or_admin(auth, obj):
        raise HTTPException(status_code=403, detail="Not your autorun")
    await _safe_delete(db, Autorun, id)
    await _safe_emit(MirrorrEvent.AUTORUN_DELETED(id=id))


crud_routers.include_router(autoruns_router)

# ── Save as Profile ────────────────────────────────────────────────────


@crud_routers.post("/sessions/{session_id}/save-as-profile")
async def save_session_as_profile(session_id: int, req: SaveProfileRequest, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    session = await crud.get_by_id(db, Session, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if not _is_owner_or_admin(auth, session):
        raise HTTPException(status_code=403, detail="Not your session")
    profile = Profile(
        name=req.name,
        default_engine_id=session.engine_id,
        resolver_id=session.resolver_id,
        resolver_config=session.resolver_config,
        retry_mode=session.retry_mode,
        retry_config=session.retry_config,
        requester_user_token=auth.user.username if auth.user else "",
    )
    db.add(profile)
    await db.commit()
    await db.refresh(profile)
    await subscribe_requester(db, profile.requester_user_token, ResourceType.PROFILE, profile.id)
    await _safe_emit(MirrorrEvent.PROFILE_CREATED(id=profile.id))
    return profile


# ── Recordings ─────────────────────────────────────────────────────────

recordings_router = APIRouter(prefix="/recordings")


@recordings_router.get("/")
async def get_all_recordings(db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    assert auth.user is not None
    if auth.is_admin:
        return await crud.get_all(db, Recording)
    stmt = select(Recording).where(Recording.requester_user_token == auth.user.username)
    result = await db.exec(stmt)
    return list(result.all())


@recordings_router.get("/{id}")
async def get_recording(id: int, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    item = await crud.get_by_id(db, Recording, id)
    if not item:
        raise HTTPException(status_code=404, detail="Recording not found")
    if not _is_owner_or_admin(auth, item):
        raise HTTPException(status_code=403, detail="Not your recording")
    return item


@recordings_router.delete("/{id}")
async def delete_recording(id: int, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    obj = await crud.get_by_id(db, Recording, id)
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    if not _is_owner_or_admin(auth, obj):
        raise HTTPException(status_code=403, detail="Not your recording")
    await _safe_delete(db, Recording, id)
    await _safe_emit(MirrorrEvent.RECORDING_DELETED(id=id))


crud_routers.include_router(recordings_router)

# ── Profiles ───────────────────────────────────────────────────────────

profiles_router = APIRouter(prefix="/profiles")


@profiles_router.get("/")
async def get_all_profiles(db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    assert auth.user is not None
    if auth.is_admin:
        return await crud.get_all(db, Profile)
    stmt = select(Profile).where(Profile.requester_user_token == auth.user.username)
    result = await db.exec(stmt)
    return list(result.all())


@profiles_router.get("/{id}")
async def get_profile(id: int, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    item = await crud.get_by_id(db, Profile, id)
    if not item:
        raise HTTPException(status_code=404, detail="Profile not found")
    if not _is_owner_or_admin(auth, item):
        raise HTTPException(status_code=403, detail="Not your profile")
    return item


@profiles_router.post("/")
async def create_profile(item: CreateProfileRequest, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    payload = Profile.model_validate(item.model_dump())
    if not payload.requester_user_token:
        assert auth.user is not None
        payload.requester_user_token = auth.user.username
    try:
        obj = await crud.create(db, payload)
    except IntegrityError as e:
        raise HTTPException(status_code=400, detail=f"Database integrity error: {e.orig}")
    await subscribe_requester(db, payload.requester_user_token, ResourceType.PROFILE, obj.id)
    await _safe_emit(MirrorrEvent.PROFILE_CREATED(id=obj.id))
    return obj


@profiles_router.put("/{id}")
async def update_profile(id: int, item: UpdateProfileRequest, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    existing = await crud.get_by_id(db, Profile, id)
    if not existing:
        raise HTTPException(status_code=404, detail="Profile not found")
    if not _is_owner_or_admin(auth, existing):
        raise HTTPException(status_code=403, detail="Not your profile")
    payload_data = item.model_dump(exclude_unset=True)
    payload = Profile.model_validate({**existing.model_dump(), **payload_data})
    if not payload.requester_user_token:
        assert auth.user is not None
        payload.requester_user_token = auth.user.username
    try:
        obj = await crud.update(db, Profile, id, payload)
    except ValueError:
        raise HTTPException(status_code=404, detail="Profile not found")
    except IntegrityError as e:
        raise HTTPException(status_code=400, detail=f"Database integrity error: {e.orig}")
    await subscribe_requester(db, payload.requester_user_token, ResourceType.PROFILE, id)
    await _safe_emit(MirrorrEvent.PROFILE_UPDATED(id=id))
    return obj


@profiles_router.delete("/{id}")
async def delete_profile(id: int, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    obj = await crud.get_by_id(db, Profile, id)
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    if not _is_owner_or_admin(auth, obj):
        raise HTTPException(status_code=403, detail="Not your profile")
    await _safe_delete(db, Profile, id)
    await _safe_emit(MirrorrEvent.PROFILE_DELETED(id=id))


crud_routers.include_router(profiles_router)

# ── Engines ────────────────────────────────────────────────────────────

engines_router = APIRouter(prefix="/engines")


@engines_router.get("/")
async def get_all_engines(db: AsyncSession = Depends(_get_db_session)):
    return await crud.get_all(db, Engine)


@engines_router.get("/{id}")
async def get_engine(id: int, db: AsyncSession = Depends(_get_db_session)):
    item = await crud.get_by_id(db, Engine, id)
    if not item:
        raise HTTPException(status_code=404, detail="Engine not found")
    return item


crud_routers.include_router(engines_router)

# ── Resolvers ──────────────────────────────────────────────────────────

resolvers_router = APIRouter(prefix="/resolvers")


@resolvers_router.get("/")
async def get_all_resolvers(db: AsyncSession = Depends(_get_db_session)):
    return await crud.get_all(db, Resolver)


@resolvers_router.get("/{id}")
async def get_resolver(id: int, db: AsyncSession = Depends(_get_db_session)):
    item = await crud.get_by_id(db, Resolver, id)
    if not item:
        raise HTTPException(status_code=404, detail="Resolver not found")
    return item


crud_routers.include_router(resolvers_router)

# ── Session control ────────────────────────────────────────────────────

session_control_router = APIRouter(prefix="/sessions")


async def _send_control(session_id: int, command: str, timeout: float = 5.0) -> dict:
    event = MirrorrEvent.SESSION_STOP_REQUESTED(id=session_id, command=command)
    try:
        msg = await bus.nc.request(
            f"session.{session_id}.control",
            event.model_dump_json().encode(),
            timeout=timeout,
        )
        reply = json.loads(msg.data.decode())
    except Exception:
        raise HTTPException(status_code=504, detail=f"Session supervisor {session_id} is not responding")

    if "error" in reply:
        raise HTTPException(status_code=400, detail=reply["error"])
    return reply


async def _require_session_owner(session_id: int, auth: AuthState, db: AsyncSession) -> Session:
    obj = await crud.get_by_id(db, Session, session_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Session not found")
    if not _is_owner_or_admin(auth, obj):
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
