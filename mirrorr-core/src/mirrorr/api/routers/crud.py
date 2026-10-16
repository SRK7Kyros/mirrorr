from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from urllib.parse import urlparse

from sqlalchemy.exc import IntegrityError
from sqlalchemy import or_ as sa_or
from sqlalchemy.orm import selectinload
from loguru import logger
from mirrorr.event_bus.nats import bus, get_control_nc
from mirrorr.event_bus.event import MirrorrEvent, BaseEvent
from typing import Any, TypeVar
from collections.abc import Sequence
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import SQLModel, select
from sqlmodel.ext.asyncio.session import AsyncSession
from mirrorr.api.dependencies import _get_db_session, require_auth, AuthState
from mirrorr.api.privileged import PrivilegedRoute
from mirrorr.api.auth import subscribe_requester
from mirrorr.api.schemas import (
    CreateSessionRequest,
    CreateAutorunRequest,
    UpdateAutorunRequest,
    CreateProfileRequest,
    UpdateProfileRequest,
    SaveProfileRequest,
    CreateResolverSourceRequest,
    UpdateResolverSourceRequest,
    SessionResponse,
    AutorunResponse,
    RecordingResponse,
    ProfileResponse,
    EngineResponse,
    ResolverResponse,
    SessionListResponse,
    AutorunListResponse,
    RecordingListResponse,
    ProfileListResponse,
    EngineListResponse,
    ResolverListResponse,
    ResolverSourceResponse,
    ResolverSourceListResponse,
    DiscoveryRequest,
    DiscoveryResponse,
    DeleteResultResponse,
)
from mirrorr.storage.models import Session, Autorun, Recording, Profile, Engine, Resolver, ResolverSource, ResourceAccess
from mirrorr.services.permissions import has_capability
from mirrorr.services.session_helpers import build_session_urls
from mirrorr.storage.enums import SessionStatus, ResourceType, AutorunStatus, Capability
from mirrorr.storage import crud
from mirrorr.storage.models import EventSubscription, Notification

crud_routers = APIRouter()


async def _cleanup_related_records(db: AsyncSession, resource_type: ResourceType, resource_id: int) -> None:
    """Clean up EventSubscription, Notification and view-grant records for a deleted entity.

    Every caller passes a ``ResourceType`` member. ``resource_access.resource_type``
    stores the enum **name** (``SESSION``) while ``event_subscriptions``/``notifications``
    store the value (``session``); the same member binds correctly to both columns.
    """
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
    await db.exec(
        sql_delete(ResourceAccess).where(
            ResourceAccess.resource_type == resource_type,
            ResourceAccess.resource_id == resource_id,
        )
    )
    await db.flush()


async def _count_related_records(db: AsyncSession, resource_type: str, resource_id: int) -> dict[str, int]:
    """Count (but do not mutate) subscriptions/notifications for a resource."""
    subs = await db.exec(
        select(EventSubscription).where(
            EventSubscription.resource_type == resource_type,
            EventSubscription.resource_id == resource_id,
        )
    )
    notifs = await db.exec(
        select(Notification).where(
            Notification.resource_type == resource_type,
            Notification.resource_id == resource_id,
        )
    )
    return {"subscriptions": len(subs.all()), "notifications": len(notifs.all())}


async def _cascade_delete_session(db: AsyncSession, session_id: int) -> dict[str, int]:
    """Delete a session row plus its related records. Never touches recordings
    on disk/DB — they remain, with ``session_id`` nulled (they outlive sessions).

    Returns a dict of counts (``{"recordings": N, "subscriptions": N, ...}``).
    Does NOT emit events — callers emit SESSION_DELETED themselves.
    """
    counts: dict[str, int] = {}

    # Detach recordings (keep the artifacts)
    recs = (await db.exec(select(Recording).where(Recording.session_id == session_id))).all()
    if recs:
        for r in recs:
            r.session_id = None
            db.add(r)
        counts["recordings"] = len(recs)

    counts.update(await _count_related_records(db, ResourceType.SESSION, session_id))
    await _cleanup_related_records(db, ResourceType.SESSION, session_id)
    await db.flush()
    await _safe_delete(db, Session, session_id)
    return counts


async def _reclaim_session(session_id: int, session_folder: str | None) -> None:
    """Stop the supervisor serving a deleted session, then remove its folder.

    Order matters: the run has to be over before its folder goes, or the media
    processes keep writing into a directory we are removing.
    """
    from mirrorr.di import container
    from mirrorr.event_bus.handlers.handlers import _kill_supervisor
    from mirrorr.services.session_lifecycle import remove_session_folder

    await _kill_supervisor(session_id)
    await remove_session_folder(container.settings, session_folder)


async def _cascade_delete_autorun(db: AsyncSession, autorun_id: int) -> dict[str, int]:
    """Delete an autorun and its sessions (each session's recordings are
    detached, not deleted). Emits AUTORUN_DELETED. Returns cascade counts."""
    counts: dict[str, int] = {"autoruns": 1}
    sess = (await db.exec(select(Session).where(Session.autorun_id == autorun_id))).all()
    for s in sess:
        folder = s.session_folder
        sub = await _cascade_delete_session(db, s.id)
        for k, v in sub.items():
            counts[k] = counts.get(k, 0) + v
        await _reclaim_session(s.id, folder)
        await _safe_emit(MirrorrEvent.SESSION_DELETED(id=s.id))
    counts["sessions"] = counts.get("sessions", 0) + len(sess)

    counts.update(await _count_related_records(db, ResourceType.AUTORUN, autorun_id))
    await _cleanup_related_records(db, ResourceType.AUTORUN, autorun_id)
    await _safe_delete(db, Autorun, autorun_id)
    await _safe_emit(MirrorrEvent.AUTORUN_DELETED(id=autorun_id))
    return counts


async def _cascade_delete_profile(db: AsyncSession, profile_id: int) -> dict[str, int]:
    """Delete a profile, its autoruns (and their sessions), and its
    standalone sessions. Recordings are detached, not deleted. Emits
    PROFILE_DELETED. Returns cascade counts."""
    counts: dict[str, int] = {"profiles": 1}

    # Standalone sessions (not spawned by an autorun)
    sess = (await db.exec(
        select(Session).where(Session.profile_id == profile_id, Session.autorun_id.is_(None))
    )).all()
    for s in sess:
        folder = s.session_folder
        sub = await _cascade_delete_session(db, s.id)
        for k, v in sub.items():
            counts[k] = counts.get(k, 0) + v
        await _reclaim_session(s.id, folder)
        await _safe_emit(MirrorrEvent.SESSION_DELETED(id=s.id))
    counts["sessions"] = counts.get("sessions", 0) + len(sess)

    # Autoruns referencing this profile (which cascade to their sessions)
    autoruns = (await db.exec(select(Autorun).where(Autorun.profile_id == profile_id))).all()
    for a in autoruns:
        sub = await _cascade_delete_autorun(db, a.id)
        for k, v in sub.items():
            counts[k] = counts.get(k, 0) + v

    counts.update(await _count_related_records(db, ResourceType.PROFILE, profile_id))
    await _cleanup_related_records(db, ResourceType.PROFILE, profile_id)
    await _safe_delete(db, Profile, profile_id)
    await _safe_emit(MirrorrEvent.PROFILE_DELETED(id=profile_id))
    return counts


# The five owner-bearing resource kinds a grant can point at, mapped to the
# ``resource_access`` tag. Engines and resolvers are ownerless system rows on
# the admin surface and are not here.
_ACCESS_MODEL_TYPES: dict[type, ResourceType] = {
    Session: ResourceType.SESSION,
    Autorun: ResourceType.AUTORUN,
    Recording: ResourceType.RECORDING,
    Profile: ResourceType.PROFILE,
    ResolverSource: ResourceType.SOURCE,
}


async def _require_read_access(db: AsyncSession, auth: AuthState, obj) -> bool:
    """``VIEW`` access to *obj*: owner, admin, or an explicit ``VIEW`` grant.

    A bool wrapper over the frozen ``has_capability`` predicate, so read handlers
    (and ``routers/logs.py``) keep their 403 shape while the decision moves to
    capabilities. Deliberately used on **read handlers only** — ``VIEW`` admits
    reads, never control, update, delete, save-as-profile, export/import or
    linking the item into another principal's own object. Authentication is owned
    by the ``require_auth`` dependency, so no anonymous caller reaches a handler.
    """
    return await has_capability(db, auth, obj, Capability.VIEW)


async def _load_owned_profile(
    db: AsyncSession, profile_id: int | None, auth: AuthState
) -> Profile | None:
    """Load a profile a request points at, enforcing ``EDIT``.

    A profile carries capture config (resolver_config, retry policy), so a
    caller may only link to a profile they hold ``EDIT`` on — otherwise pointing
    at another user's profile would leak that config into their own
    session/autorun. Owner, admin, and an ``EDIT`` grantee may reference it.
    """
    if profile_id is None:
        return None
    profile = await crud.get_by_id(db, Profile, profile_id)
    if not profile:
        raise HTTPException(status_code=400, detail=f"Profile {profile_id} not found")
    if not await has_capability(db, auth, profile, Capability.EDIT):
        raise HTTPException(status_code=403, detail="Not your profile")
    return profile


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


T = TypeVar("T", bound=SQLModel)


_LIVE_CONFIG_FIELDS = ("engine_id", "resolver_id", "resolver_config", "profile_id", "retry_mode", "retry_config")
_TEARDOWN_STATUSES = (AutorunStatus.TERMINATING, AutorunStatus.REMUXING, AutorunStatus.FINALIZING)
_SPENT_STATUSES = (AutorunStatus.COMPLETED, AutorunStatus.FAILED)


def _naive_utc(value) -> datetime:
    """Normalize an incoming datetime to naive UTC for comparison/storage.

    Aware values are converted to UTC then dropped to naive; naive values
    are compared as-is (server clock, matching the DB convention).
    """
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _guard_denied(status_code: int, detail: str, rule: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"detail": detail, "rule": rule})


def _enforce_autorun_update_guard(existing: Autorun, payload_data: dict) -> None:
    """Field-level guard for ``PUT /autoruns/{id}`` (mirrorr-ui-remake Todo 1).

    Status families mirror ``storage.enums.AutorunStatus``; ``overdue`` is
    derived (``SCHEDULED`` with ``start_time`` in the past), never stored.

    Re-checks status right before write so a scheduler tick that flips
    SCHEDULED→ACTIVE between draft and submit lands 409, never 200.
    """
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    status = existing.status
    config_fields = [f for f in _LIVE_CONFIG_FIELDS if f in payload_data]

    new_start = payload_data.get("start_time", existing.start_time)
    new_start = _naive_utc(new_start) if new_start is not None else None
    new_end = payload_data.get("end_time", existing.end_time)
    new_end = _naive_utc(new_end) if new_end is not None else None
    wants_start = "start_time" in payload_data
    wants_end = "end_time" in payload_data

    if wants_start or wants_end:
        if new_start is not None and new_end is not None and new_end <= new_start:
            raise _guard_denied(422, "End must be after start", "end-before-start")

    if status == AutorunStatus.SCHEDULED:
        overdue = existing.start_time is not None and _naive_utc(existing.start_time) < now
        if wants_start and new_start is not None and new_start < now:
            if overdue:
                raise _guard_denied(422, "Overdue autorun can only be re-armed to the future", "time-travel")
            raise _guard_denied(422, "Start must be in the future", "time-travel")
        if wants_end and new_end is not None and new_end <= now:
            raise _guard_denied(422, "End must be in the future", "end-must-be-future")
        return

    if status in (AutorunStatus.ACTIVE, AutorunStatus.RECORDING):
        if wants_start:
            raise _guard_denied(409, "Start is frozen while live", "live-start-frozen")
        if config_fields:
            raise _guard_denied(
                409,
                "Engine and resolver config are frozen while live",
                "live-config-frozen",
            )
        # Live end edits stay free even when shortened to the past: the
        # scheduler stops the session on the next tick (~2x check interval).
        return

    if status in _TEARDOWN_STATUSES:
        if wants_start or wants_end:
            raise _guard_denied(409, "Schedule is frozen while tearing down", "teardown-race")
        return

    if status in _SPENT_STATUSES:
        if wants_start or wants_end or config_fields:
            raise _guard_denied(409, "Completed history is immutable", "history-immutable")
        return


async def _get_paginated_for_user(
    db: AsyncSession,
    model: type[T],
    user_token: str,
    *,
    cursor: int | None = None,
    limit: int = 50,
    options: Sequence = (),
    include_total: bool = False,
) -> dict:
    """Cursor-based pagination filtered by owner or explicit ``VIEW`` grant.

    A caller sees the rows they own (``requester_user_token``) *and* any row
    carrying a ``VIEW`` grant for them in ``resource_access``. Engines/resolvers
    have no owner column and never route through here.

    Returns {"items": [...], "next_cursor": ..., "has_more": ...}.
    """
    owner_match = model.requester_user_token == user_token
    resource_type = _ACCESS_MODEL_TYPES.get(model)
    if resource_type is None:
        predicate = owner_match
    else:
        granted = (
            select(ResourceAccess.id)
            .where(
                ResourceAccess.resource_type == resource_type,
                ResourceAccess.resource_id == model.id,
                ResourceAccess.username == user_token,
                ResourceAccess.capability == Capability.VIEW,
            )
            .exists()
        )
        predicate = sa_or(owner_match, granted)
    stmt = select(model).where(predicate)
    if cursor is not None:
        stmt = stmt.where(model.id < cursor)
    if options:
        stmt = stmt.options(*options)
    stmt = stmt.order_by(model.id.desc()).limit(limit + 1)
    items = list((await db.exec(stmt)).all())
    has_more = len(items) > limit
    if has_more:
        items = items[:limit]
    total = None
    if include_total:
        total = await crud.count(db, model, predicate)
    return {
        "items": items,
        "next_cursor": items[-1].id if has_more and items else None,
        "has_more": has_more,
        "total": total,
    }


def _paginate_response(result: crud.PaginatedResult | dict) -> dict:
    """Normalize a PaginatedResult or dict into the standard response shape."""
    if isinstance(result, dict):
        return result
    return {"items": result.items, "next_cursor": result.next_cursor, "has_more": result.has_more}


def _serialize_engine(engine: Engine) -> dict:
    """Shape an Engine ORM row for the API, coercing the nested Pydantic
    Capabilities model into the plain dict the response schema declares."""
    return {
        "id": engine.id,
        "name": engine.name,
        "description": engine.description,
        "origin": engine.origin,
        "origin_hash": engine.origin_hash,
        "capabilities": (
            engine.capabilities.model_dump()
            if hasattr(engine.capabilities, "model_dump")
            else engine.capabilities
        ),
        "retry_modes_schema": engine.retry_modes_schema,
    }


def _name_of(obj) -> str | None:
    """Best-effort name accessor on an eager-loaded relationship."""
    if obj is None:
        return None
    return getattr(obj, "name", None)


def _autorun_name(obj) -> str | None:
    """Autoruns title themselves with `user_friendly_name`, not `name`."""
    if obj is None:
        return None
    return getattr(obj, "user_friendly_name", None)


def _session_urls(s: Session) -> list[dict[str, str]]:
    """Live URLs for a session, derived from its folder and the public base.

    Recomputed on read so the list follows ``web_url`` and the files actually
    on disk, rather than the snapshot captured when the attempt first ran.
    """
    stored = s.session_urls or []
    folder = getattr(s, "session_folder", None)
    if not folder:
        return stored
    try:
        from mirrorr.di import container

        settings = container.settings
    except Exception:  # noqa: BLE001 — DI not booted (subprocess/tests)
        return stored
    path = Path(folder)
    if not path.is_dir():
        return stored
    return build_session_urls(path, path / "segments", settings) or stored


def _serialize_session(s: Session) -> dict:
    # `session_folder` is a server filesystem path — never expose it to a client.
    return {
        **s.model_dump(mode="json", exclude={"session_folder"}),
        "session_urls": _session_urls(s),
        "engine_name": _name_of(getattr(s, "engine", None)),
        "resolver_name": _name_of(getattr(s, "resolver", None)),
        "profile_name": _name_of(getattr(s, "profile", None)),
        "autorun_name": _autorun_name(getattr(s, "autorun", None)),
    }


def _serialize_autorun(a: Autorun) -> dict:
    return {
        **a.model_dump(mode="json"),
        "engine_name": _name_of(getattr(a, "engine", None)),
        "resolver_name": _name_of(getattr(a, "resolver", None)),
        "profile_name": _name_of(getattr(a, "profile", None)),
    }


def _serialize_profile(p: Profile) -> dict:
    return {
        **p.model_dump(mode="json"),
        "engine_name": _name_of(getattr(p, "default_engine", None)),
        "resolver_name": _name_of(getattr(p, "resolver", None)),
    }


def _serialize_source(p: ResolverSource) -> dict:
    return {
        **p.model_dump(mode="json"),
        "resolver_name": _name_of(getattr(p, "resolver", None)),
    }


def _media_served(recording: Recording) -> bool:
    """Whether this install serves the recording's media over HTTP.

    True when uvicorn mounts the content dir (``dev_serve_files``, dev only) or
    the exact file behind ``content_url`` is present under the served content
    root — in production nginx serves ``/content/`` straight from that root, so
    a present file means a working URL. Safe to call in any context — returns
    False if the DI container isn't booted.
    """
    try:
        from mirrorr.di import container

        settings = container.settings
    except Exception:  # noqa: broad-except — not configured / subprocess
        return False
    if settings.dev_serve_files:
        return True
    name = PurePosixPath(urlparse(recording.content_url).path).name
    return bool(name) and (Path(recording.disk_path) / name).is_file()


def _serialize_recording(r: Recording) -> dict:
    # `disk_path` is a server filesystem path — never expose it to a client.
    return {
        **r.model_dump(mode="json", exclude={"disk_path"}),
        "media_served": _media_served(r),
    }


_SESSION_OPTIONS = (
    selectinload(Session.engine),
    selectinload(Session.resolver),
    selectinload(Session.profile),
    selectinload(Session.autorun),
)
_AUTORUN_OPTIONS = (
    selectinload(Autorun.engine),
    selectinload(Autorun.resolver),
    selectinload(Autorun.profile),
)
_PROFILE_OPTIONS = (
    selectinload(Profile.default_engine),
    selectinload(Profile.resolver),
)
_SOURCE_OPTIONS = (selectinload(ResolverSource.resolver),)


# ── Sessions ──────────────────────────────────────────────────────────

sessions_router = APIRouter(prefix="/sessions", route_class=PrivilegedRoute)


@sessions_router.get("/", response_model=SessionListResponse)
async def get_all_sessions(
    db: AsyncSession = Depends(_get_db_session),
    auth: AuthState = Depends(require_auth),
    cursor: int | None = Query(None, description="ID of last item from previous page"),
    limit: int = Query(50, ge=1, le=200, description="Items per page"),
    include_total: bool = Query(False, description="Include a total row count in the response"),
):
    total = None
    if auth.is_admin:
        result = await crud.get_all_paginated(db, Session, cursor=cursor, limit=limit, options=_SESSION_OPTIONS)
        if include_total:
            total = await crud.count(db, Session)
    else:
        result = await _get_paginated_for_user(
            db, Session, auth.user.username, cursor=cursor, limit=limit, options=_SESSION_OPTIONS,
            include_total=include_total,
        )
        total = result.get("total") if isinstance(result, dict) else None
    data = _paginate_response(result)
    if isinstance(data.get("items"), list):
        data["items"] = [_serialize_session(i) for i in data["items"]]
    return {**data, "total": total}


@sessions_router.get("/{id}", response_model=SessionResponse)
async def get_session(id: int, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    item = await crud.get_by_id(db, Session, id, options=_SESSION_OPTIONS)
    if not item:
        raise HTTPException(status_code=404, detail="Session not found")
    if not await _require_read_access(db, auth, item):
        raise HTTPException(status_code=403, detail="Not your session")
    return _serialize_session(item)


def _resolve_capture_target(
    profile: Profile | None,
    engine_id: int | None,
    resolver_id: int | None,
    resolver_config: dict[str, Any] | None,
    retry_mode: str | None,
    retry_config: dict[str, Any] | None,
) -> tuple[int, int, dict[str, Any], str, dict[str, Any]]:
    """Resolve the engine, resolver and policy a capture runs with.

    A profile supplies whatever the request leaves unset, so a caller may start
    from a profile alone; a bare request must still name an engine and resolver.
    """
    if profile is None:
        if engine_id is None or resolver_id is None:
            raise HTTPException(status_code=422, detail="Provide a profile, or an engine and a resolver")
        return engine_id, resolver_id, resolver_config or {}, retry_mode or "none", retry_config or {}
    return (
        engine_id if engine_id is not None else profile.default_engine_id,
        resolver_id if resolver_id is not None else profile.resolver_id,
        resolver_config if resolver_config is not None else profile.resolver_config,
        retry_mode if retry_mode is not None else profile.retry_mode,
        retry_config if retry_config is not None else profile.retry_config,
    )


def _merge_profile_capture(profile: Profile | None, payload_data: dict[str, Any]) -> dict[str, Any]:
    """Fold the profile a PUT now points at into the payload's capture config.

    A profile link is only a link: ``Autorun.engine_id``/``resolver_id``/
    ``resolver_config``/retry columns are what the scheduler actually runs with.
    Mirroring ``POST /autoruns/``, a profile change re-derives them here so
    switching profiles changes the capture, not just the ``profile_id``.
    """
    engine_id, resolver_id, resolver_config, retry_mode, retry_config = _resolve_capture_target(
        profile,
        payload_data.get("engine_id"),
        payload_data.get("resolver_id"),
        payload_data.get("resolver_config"),
        payload_data.get("retry_mode"),
        payload_data.get("retry_config"),
    )
    return payload_data | {
        "engine_id": engine_id,
        "resolver_id": resolver_id,
        "resolver_config": resolver_config,
        "retry_mode": retry_mode,
        "retry_config": retry_config,
    }


@sessions_router.post("/", response_model=SessionResponse)
async def create_session(item: CreateSessionRequest, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    profile = await _load_owned_profile(db, item.profile_id, auth)
    engine_id, resolver_id, resolver_config, retry_mode, retry_config = _resolve_capture_target(
        profile, item.engine_id, item.resolver_id, item.resolver_config, item.retry_mode, item.retry_config
    )
    engine = await crud.get_by_id(db, Engine, engine_id)
    if not engine:
        raise HTTPException(status_code=400, detail=f"Engine {engine_id} not found")
    resolver = await crud.get_by_id(db, Resolver, resolver_id)
    if not resolver:
        raise HTTPException(status_code=400, detail=f"Resolver {resolver_id} not found")
    if not auth.user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = Session(
        id=await crud.next_free_id(db, Session),
        profile_id=item.profile_id,
        engine_id=engine_id,
        resolver_id=resolver_id,
        resolver_config=resolver_config,
        retry_mode=retry_mode,
        retry_config=retry_config,
        recording=item.recording,
        requester_user_token=auth.user.username,
    )
    try:
        obj = await crud.create(db, payload)
    except IntegrityError as e:
        raise HTTPException(status_code=400, detail="A resource with that name already exists.")
    await subscribe_requester(db, payload.requester_user_token, ResourceType.SESSION, obj.id)
    await _safe_emit(MirrorrEvent.SESSION_CREATED(id=obj.id))
    enriched = await crud.get_by_id(db, Session, obj.id, options=_SESSION_OPTIONS)
    return _serialize_session(enriched) if enriched else obj


@sessions_router.delete("/{id}", response_model=DeleteResultResponse)
async def delete_session(id: int, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    obj = await crud.get_by_id(db, Session, id)
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    if not await has_capability(db, auth, obj, Capability.DELETE):
        raise HTTPException(status_code=403, detail="Not your session")
    if obj.status == SessionStatus.REMUXING:
        raise HTTPException(status_code=409, detail="Session is remuxing. Wait for it to complete or fail before deleting.")
    if obj.status in (SessionStatus.ACTIVE, SessionStatus.RECORDING, SessionStatus.TERMINATING):
        try:
            # Ask the supervisor to wind down. A supervisor that is already gone
            # (504) is not an error here — _reclaim_session() settles it below.
            await _send_control(id, "stop")
        except HTTPException as e:
            if e.status_code != 504:
                raise
    folder = obj.session_folder
    counts = await _cascade_delete_session(db, id)
    await _reclaim_session(id, folder)
    await _safe_emit(MirrorrEvent.SESSION_DELETED(id=id))
    return DeleteResultResponse(status="deleted", deleted=counts)


crud_routers.include_router(sessions_router)

# ── Autoruns ───────────────────────────────────────────────────────────

autoruns_router = APIRouter(prefix="/autoruns", route_class=PrivilegedRoute)


@autoruns_router.get("/", response_model=AutorunListResponse)
async def get_all_autoruns(
    db: AsyncSession = Depends(_get_db_session),
    auth: AuthState = Depends(require_auth),
    cursor: int | None = Query(None, description="ID of last item from previous page"),
    limit: int = Query(50, ge=1, le=200, description="Items per page"),
    include_total: bool = Query(False, description="Include a total row count in the response"),
):
    total = None
    if auth.is_admin:
        result = await crud.get_all_paginated(db, Autorun, cursor=cursor, limit=limit, options=_AUTORUN_OPTIONS)
        if include_total:
            total = await crud.count(db, Autorun)
    else:
        result = await _get_paginated_for_user(
            db, Autorun, auth.user.username, cursor=cursor, limit=limit, options=_AUTORUN_OPTIONS,
            include_total=include_total,
        )
        total = result.get("total") if isinstance(result, dict) else None
    data = _paginate_response(result)
    if isinstance(data.get("items"), list):
        data["items"] = [_serialize_autorun(i) for i in data["items"]]
    return {**data, "total": total}


@autoruns_router.get("/{id}", response_model=AutorunResponse)
async def get_autorun(id: int, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    item = await crud.get_by_id(db, Autorun, id, options=_AUTORUN_OPTIONS)
    if not item:
        raise HTTPException(status_code=404, detail="Autorun not found")
    if not await _require_read_access(db, auth, item):
        raise HTTPException(status_code=403, detail="Not your autorun")
    return _serialize_autorun(item)


@autoruns_router.post("/", response_model=AutorunResponse)
async def create_autorun(item: CreateAutorunRequest, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    profile = await _load_owned_profile(db, item.profile_id, auth)
    engine_id, resolver_id, resolver_config, retry_mode, retry_config = _resolve_capture_target(
        profile, item.engine_id, item.resolver_id, item.resolver_config, item.retry_mode, item.retry_config
    )
    engine = await crud.get_by_id(db, Engine, engine_id)
    if not engine:
        raise HTTPException(status_code=400, detail=f"Engine {engine_id} not found")
    resolver = await crud.get_by_id(db, Resolver, resolver_id)
    if not resolver:
        raise HTTPException(status_code=400, detail=f"Resolver {resolver_id} not found")
    if not auth.user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = Autorun(
        user_friendly_name=item.user_friendly_name,
        snake_case_name=item.snake_case_name,
        profile_id=item.profile_id,
        engine_id=engine_id,
        resolver_id=resolver_id,
        resolver_config=resolver_config,
        retry_mode=retry_mode,
        retry_config=retry_config,
        start_time=item.start_time.replace(tzinfo=None) if item.start_time.tzinfo else item.start_time,
        end_time=item.end_time.replace(tzinfo=None) if item.end_time.tzinfo else item.end_time,
        recording=item.recording,
        requester_user_token=auth.user.username,
        next_run_at=item.start_time.replace(tzinfo=None) if item.start_time.tzinfo else item.start_time,
    )
    try:
        obj = await crud.create(db, payload)
    except IntegrityError as e:
        raise HTTPException(status_code=400, detail="A resource with that name already exists.")
    await subscribe_requester(db, payload.requester_user_token, ResourceType.AUTORUN, obj.id)
    await _safe_emit(MirrorrEvent.AUTORUN_CREATED(id=obj.id))
    enriched = await crud.get_by_id(db, Autorun, obj.id, options=_AUTORUN_OPTIONS)
    return _serialize_autorun(enriched) if enriched else obj


@autoruns_router.put("/{id}", response_model=AutorunResponse)
async def update_autorun(id: int, item: UpdateAutorunRequest, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    existing = await crud.get_by_id(db, Autorun, id)
    if not existing:
        raise HTTPException(status_code=404, detail="Autorun not found")
    if not await has_capability(db, auth, existing, Capability.EDIT):
        raise HTTPException(status_code=403, detail="Not your autorun")
    payload_data = item.model_dump(exclude_unset=True)
    _enforce_autorun_update_guard(existing, payload_data)
    if "profile_id" in payload_data:
        profile = await _load_owned_profile(db, payload_data["profile_id"], auth)
        payload_data = _merge_profile_capture(profile, payload_data)
    if "start_time" in payload_data and payload_data["start_time"] is not None:
        payload_data["start_time"] = payload_data["start_time"].replace(tzinfo=None) if payload_data["start_time"].tzinfo else payload_data["start_time"]
    if "end_time" in payload_data and payload_data["end_time"] is not None:
        payload_data["end_time"] = payload_data["end_time"].replace(tzinfo=None) if payload_data["end_time"].tzinfo else payload_data["end_time"]
    # Reflect the new start in next_run_at while the autorun is still pending.
    if "start_time" in payload_data and existing.status == AutorunStatus.SCHEDULED:
        payload_data["next_run_at"] = payload_data["start_time"]
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
    enriched = await crud.get_by_id(db, Autorun, id, options=_AUTORUN_OPTIONS)
    return _serialize_autorun(enriched) if enriched else obj


@autoruns_router.delete("/{id}", response_model=DeleteResultResponse)
async def delete_autorun(id: int, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    obj = await crud.get_by_id(db, Autorun, id)
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    if not await has_capability(db, auth, obj, Capability.DELETE):
        raise HTTPException(status_code=403, detail="Not your autorun")
    counts = await _cascade_delete_autorun(db, id)
    return DeleteResultResponse(status="deleted", deleted=counts)

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
    """Create a Profile from an existing entity's fields (session or autorun).

    Regression note (API-key gotcha): all create paths require JWT
    (require_auth). ``auth.user`` is never None here — the explicit 401
    below turns a would-be empty ``requester_user_token`` (invisible
    resource, no subscription/WS) into a loud failure.
    """
    if not auth.user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    profile = Profile(
        name=name,
        default_engine_id=engine_id,
        resolver_id=resolver_id,
        resolver_config=resolver_config,
        retry_mode=retry_mode,
        retry_config=retry_config,
        requester_user_token=auth.user.username,
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
    if not await has_capability(db, auth, autorun, Capability.EDIT):
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
    if not await has_capability(db, auth, session, Capability.EDIT):
        raise HTTPException(status_code=403, detail="Not your session")
    return await _create_profile_from_entity(
        db, auth, req.name,
        session.engine_id, session.resolver_id, session.resolver_config,
        session.retry_mode, session.retry_config,
    )


# ── Recordings ─────────────────────────────────────────────────────────

recordings_router = APIRouter(prefix="/recordings", route_class=PrivilegedRoute)


@recordings_router.get("/", response_model=RecordingListResponse)
async def get_all_recordings(
    db: AsyncSession = Depends(_get_db_session),
    auth: AuthState = Depends(require_auth),
    cursor: int | None = Query(None, description="ID of last item from previous page"),
    limit: int = Query(50, ge=1, le=200, description="Items per page"),
    include_total: bool = Query(False, description="Include a total row count in the response"),
):
    total = None
    if auth.is_admin:
        result = await crud.get_all_paginated(db, Recording, cursor=cursor, limit=limit)
        if include_total:
            total = await crud.count(db, Recording)
    else:
        result = await _get_paginated_for_user(
            db, Recording, auth.user.username, cursor=cursor, limit=limit, include_total=include_total,
        )
        total = result.get("total") if isinstance(result, dict) else None
    data = _paginate_response(result)
    if isinstance(data.get("items"), list):
        data["items"] = [_serialize_recording(i) for i in data["items"]]
    return {**data, "total": total}


@recordings_router.get("/{id}", response_model=RecordingResponse)
async def get_recording(id: int, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    item = await crud.get_by_id(db, Recording, id)
    if not item:
        raise HTTPException(status_code=404, detail="Recording not found")
    if not await _require_read_access(db, auth, item):
        raise HTTPException(status_code=403, detail="Not your recording")
    return _serialize_recording(item)


@recordings_router.delete("/{id}", response_model=DeleteResultResponse)
async def delete_recording(id: int, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    obj = await crud.get_by_id(db, Recording, id)
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    if not await has_capability(db, auth, obj, Capability.DELETE):
        raise HTTPException(status_code=403, detail="Not your recording")

    counts = await _count_related_records(db, ResourceType.RECORDING, id)
    await _cleanup_related_records(db, ResourceType.RECORDING, id)
    await _safe_delete(db, Recording, id)
    await _safe_emit(MirrorrEvent.RECORDING_DELETED(id=id))
    return DeleteResultResponse(status="deleted", deleted=counts)


crud_routers.include_router(recordings_router)

# ── Profiles ───────────────────────────────────────────────────────────

profiles_router = APIRouter(prefix="/profiles", route_class=PrivilegedRoute)


@profiles_router.get("/", response_model=ProfileListResponse)
async def get_all_profiles(
    db: AsyncSession = Depends(_get_db_session),
    auth: AuthState = Depends(require_auth),
    cursor: int | None = Query(None, description="ID of last item from previous page"),
    limit: int = Query(50, ge=1, le=200, description="Items per page"),
    include_total: bool = Query(False, description="Include a total row count in the response"),
):
    total = None
    if auth.is_admin:
        result = await crud.get_all_paginated(db, Profile, cursor=cursor, limit=limit, options=_PROFILE_OPTIONS)
        if include_total:
            total = await crud.count(db, Profile)
    else:
        result = await _get_paginated_for_user(
            db, Profile, auth.user.username, cursor=cursor, limit=limit, options=_PROFILE_OPTIONS,
            include_total=include_total,
        )
        total = result.get("total") if isinstance(result, dict) else None
    data = _paginate_response(result)
    if isinstance(data.get("items"), list):
        data["items"] = [_serialize_profile(i) for i in data["items"]]
    return {**data, "total": total}


@profiles_router.get("/{id}", response_model=ProfileResponse)
async def get_profile(id: int, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    item = await crud.get_by_id(db, Profile, id, options=_PROFILE_OPTIONS)
    if not item:
        raise HTTPException(status_code=404, detail="Profile not found")
    if not await _require_read_access(db, auth, item):
        raise HTTPException(status_code=403, detail="Not your profile")
    return _serialize_profile(item)


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
    enriched = await crud.get_by_id(db, Profile, obj.id, options=_PROFILE_OPTIONS)
    return _serialize_profile(enriched) if enriched else obj


@profiles_router.put("/{id}", response_model=ProfileResponse)
async def update_profile(id: int, item: UpdateProfileRequest, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    existing = await crud.get_by_id(db, Profile, id)
    if not existing:
        raise HTTPException(status_code=404, detail="Profile not found")
    if not await has_capability(db, auth, existing, Capability.EDIT):
        raise HTTPException(status_code=403, detail="Not your profile")
    payload_data = item.model_dump(exclude_unset=True)
    payload = Profile.model_validate({**existing.model_dump(), **payload_data})
    if not auth.user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    # An EDIT-grantee must never take ownership — only fill a blank token.
    if not payload.requester_user_token:
        payload.requester_user_token = auth.user.username
    try:
        obj = await crud.update(db, Profile, id, payload)
    except ValueError:
        raise HTTPException(status_code=404, detail="Profile not found")
    except IntegrityError as e:
        raise HTTPException(status_code=400, detail="A resource with that name already exists.")
    await subscribe_requester(db, payload.requester_user_token, ResourceType.PROFILE, id)
    await _safe_emit(MirrorrEvent.PROFILE_UPDATED(id=id))
    enriched = await crud.get_by_id(db, Profile, id, options=_PROFILE_OPTIONS)
    return _serialize_profile(enriched) if enriched else obj


@profiles_router.delete("/{id}", response_model=DeleteResultResponse)
async def delete_profile(id: int, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    obj = await crud.get_by_id(db, Profile, id)
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    if not await has_capability(db, auth, obj, Capability.DELETE):
        raise HTTPException(status_code=403, detail="Not your profile")
    counts = await _cascade_delete_profile(db, id)
    return DeleteResultResponse(status="deleted", deleted=counts)


crud_routers.include_router(profiles_router)

# ── Resolver sources ───────────────────────────────────────────────────

sources_router = APIRouter(prefix="/sources", route_class=PrivilegedRoute)


@sources_router.get("/", response_model=ResolverSourceListResponse)
async def get_all_sources(
    db: AsyncSession = Depends(_get_db_session),
    auth: AuthState = Depends(require_auth),
    cursor: int | None = Query(None, description="ID of last item from previous page"),
    limit: int = Query(50, ge=1, le=200, description="Items per page"),
    include_total: bool = Query(False, description="Include a total row count in the response"),
):
    total = None
    if auth.is_admin:
        result = await crud.get_all_paginated(db, ResolverSource, cursor=cursor, limit=limit, options=_SOURCE_OPTIONS)
        if include_total:
            total = await crud.count(db, ResolverSource)
    else:
        result = await _get_paginated_for_user(
            db, ResolverSource, auth.user.username, cursor=cursor, limit=limit, options=_SOURCE_OPTIONS,
            include_total=include_total,
        )
        total = result.get("total") if isinstance(result, dict) else None
    data = _paginate_response(result)
    if isinstance(data.get("items"), list):
        data["items"] = [_serialize_source(i) for i in data["items"]]
    return {**data, "total": total}


@sources_router.get("/{id}", response_model=ResolverSourceResponse)
async def get_source(id: int, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    item = await crud.get_by_id(db, ResolverSource, id, options=_SOURCE_OPTIONS)
    if not item:
        raise HTTPException(status_code=404, detail="Source not found")
    if not await _require_read_access(db, auth, item):
        raise HTTPException(status_code=403, detail="Not your source")
    return _serialize_source(item)


@sources_router.post("/", response_model=ResolverSourceResponse)
async def create_source(item: CreateResolverSourceRequest, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    if not await crud.get_by_id(db, Resolver, item.resolver_id):
        raise HTTPException(status_code=400, detail=f"Resolver {item.resolver_id} not found")
    if not auth.user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = ResolverSource.model_validate(item.model_dump())
    payload.requester_user_token = auth.user.username
    try:
        obj = await crud.create(db, payload)
    except IntegrityError:
        raise HTTPException(status_code=400, detail="A resource with that name already exists.")
    await subscribe_requester(db, payload.requester_user_token, ResourceType.SOURCE, obj.id)
    await _safe_emit(MirrorrEvent.RESOLVER_SOURCE_CREATED(id=obj.id))
    enriched = await crud.get_by_id(db, ResolverSource, obj.id, options=_SOURCE_OPTIONS)
    return _serialize_source(enriched) if enriched else obj


@sources_router.put("/{id}", response_model=ResolverSourceResponse)
async def update_source(id: int, item: UpdateResolverSourceRequest, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    existing = await crud.get_by_id(db, ResolverSource, id)
    if not existing:
        raise HTTPException(status_code=404, detail="Source not found")
    if not await has_capability(db, auth, existing, Capability.EDIT):
        raise HTTPException(status_code=403, detail="Not your source")
    if not auth.user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    data = item.model_dump(exclude_unset=True)
    if data.get("resolver_id") is not None and not await crud.get_by_id(db, Resolver, data["resolver_id"]):
        raise HTTPException(status_code=400, detail=f"Resolver {data['resolver_id']} not found")
    payload = ResolverSource.model_validate({**existing.model_dump(), **data})
    # An EDIT-grantee must never take ownership — only fill a blank token.
    if not payload.requester_user_token:
        payload.requester_user_token = auth.user.username
    try:
        obj = await crud.update(db, ResolverSource, id, payload)
    except ValueError:
        raise HTTPException(status_code=404, detail="Source not found")
    except IntegrityError:
        raise HTTPException(status_code=400, detail="A resource with that name already exists.")
    await subscribe_requester(db, payload.requester_user_token, ResourceType.SOURCE, id)
    await _safe_emit(MirrorrEvent.RESOLVER_SOURCE_UPDATED(id=id))
    enriched = await crud.get_by_id(db, ResolverSource, id, options=_SOURCE_OPTIONS)
    return _serialize_source(enriched) if enriched else obj


@sources_router.delete("/{id}", response_model=DeleteResultResponse)
async def delete_source(id: int, db: AsyncSession = Depends(_get_db_session), auth: AuthState = Depends(require_auth)):
    obj = await crud.get_by_id(db, ResolverSource, id)
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    if not await has_capability(db, auth, obj, Capability.DELETE):
        raise HTTPException(status_code=403, detail="Not your source")
    counts = await _count_related_records(db, ResourceType.SOURCE, id)
    await _cleanup_related_records(db, ResourceType.SOURCE, id)
    await _safe_delete(db, ResolverSource, id)
    await _safe_emit(MirrorrEvent.RESOLVER_SOURCE_DELETED(id=id))
    return DeleteResultResponse(status="deleted", deleted=counts)


crud_routers.include_router(sources_router)

# ── Engines ────────────────────────────────────────────────────────────

engines_router = APIRouter(prefix="/engines")


@engines_router.get("/", response_model=EngineListResponse)
async def get_all_engines(
    db: AsyncSession = Depends(_get_db_session),
    _auth: AuthState = Depends(require_auth),
    cursor: int | None = Query(None, description="ID of last item from previous page"),
    limit: int = Query(50, ge=1, le=200, description="Items per page"),
):
    result = await crud.get_all_paginated(db, Engine, cursor=cursor, limit=limit)
    return {
        "items": [_serialize_engine(i) for i in result.items],
        "next_cursor": result.next_cursor,
        "has_more": result.has_more,
    }


@engines_router.get("/{id}", response_model=EngineResponse)
async def get_engine(id: int, db: AsyncSession = Depends(_get_db_session), _auth: AuthState = Depends(require_auth)):
    item = await crud.get_by_id(db, Engine, id)
    if not item:
        raise HTTPException(status_code=404, detail="Engine not found")
    return _serialize_engine(item)


crud_routers.include_router(engines_router)

# ── Resolvers ──────────────────────────────────────────────────────────

resolvers_router = APIRouter(prefix="/resolvers")


@resolvers_router.get("/", response_model=ResolverListResponse)
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


@resolvers_router.post("/{id}/discover", response_model=DiscoveryResponse)
async def discover_resolver(
    id: int,
    body: DiscoveryRequest,
    db: AsyncSession = Depends(_get_db_session),
    _auth: AuthState = Depends(require_auth),
):
    resolver = await crud.get_by_id(db, Resolver, id)
    if not resolver:
        raise HTTPException(status_code=404, detail="Resolver not found")

    from pydantic import ValidationError

    from mirrorr.di import container
    from mirrorr.plugin_api.interfaces import ResolverContext
    from mirrorr.startup.ensure_resolvers import load_resolver_jit

    settings = container.settings
    interface = load_resolver_jit(settings.resolvers_dir, resolver.origin, resolver.origin_hash)
    model = interface.discovery_model
    if model is None:
        raise HTTPException(status_code=404, detail="Resolver has no discovery")

    try:
        params = model(**body.params)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=e.errors())

    scratch = settings.base_dir / "cache" / "discovery" / resolver.origin
    scratch.mkdir(parents=True, exist_ok=True)
    context = ResolverContext(bus=container.event_bus, session_folder=scratch)
    page = await (
        interface.search(body.query, params, body.cursor, context)
        if body.query
        else interface.browse(params, body.cursor, context)
    )
    if page is None:
        return {"items": [], "next_cursor": None}
    return {"items": [asdict(i) for i in page.items], "next_cursor": page.next_cursor}


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

    from nats.errors import NoRespondersError

    event = MirrorrEvent.SESSION_STOP_REQUESTED(id=session_id, command=command)
    try:
        nc = await get_control_nc()
        msg = await nc.request(
            f"session.{session_id}.control",
            event.model_dump_json().encode(),
            timeout=timeout,
        )
        reply = json.loads(msg.data.decode())
    except (_TimeoutError, NoRespondersError):
        # Either nobody answered in time or nobody is subscribed at all — both
        # mean no supervisor is running for this session.
        raise HTTPException(status_code=504, detail=f"Session supervisor {session_id} is not responding")
    except Exception as e:
        logger.error(f"Control command '{command}' failed for session {session_id}: {type(e).__name__}: {e}")
        raise HTTPException(status_code=502, detail="Session control command failed")

    if "error" in reply:
        raise HTTPException(status_code=400, detail=reply["error"])
    return reply


async def _require_session_owner(session_id: int, auth: AuthState, db: AsyncSession) -> Session:
    """Load a session and require ``OPERATE`` on it (owner, admin, or grant)."""
    obj = await crud.get_by_id(db, Session, session_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Session not found")
    if not await has_capability(db, auth, obj, Capability.OPERATE):
        raise HTTPException(status_code=403, detail="Not your session")
    return obj


@session_control_router.post("/{session_id}/stop")
async def stop_session(session_id: int, auth: AuthState = Depends(require_auth), db: AsyncSession = Depends(_get_db_session)):
    await _require_session_owner(session_id, auth, db)
    try:
        return await _send_control(session_id, "stop")
    except HTTPException as e:
        if e.status_code != 504:
            raise
        # No supervisor is listening, so no reply will ever arrive. Record the
        # stop ourselves instead of leaving the session un-stoppable.
        from mirrorr.di import container
        from mirrorr.event_bus.handlers.handlers import _kill_supervisor
        from mirrorr.services.session_lifecycle import update_session

        await _kill_supervisor(session_id)
        await update_session(container.settings, session_id, status=SessionStatus.FAILED)
        return {"status": "stopped"}


@session_control_router.post("/{session_id}/recording/enable")
async def enable_recording(session_id: int, auth: AuthState = Depends(require_auth), db: AsyncSession = Depends(_get_db_session)):
    await _require_session_owner(session_id, auth, db)
    return await _send_control(session_id, "enable_recording")


@session_control_router.post("/{session_id}/recording/disable")
async def disable_recording(session_id: int, auth: AuthState = Depends(require_auth), db: AsyncSession = Depends(_get_db_session)):
    await _require_session_owner(session_id, auth, db)
    return await _send_control(session_id, "disable_recording")
