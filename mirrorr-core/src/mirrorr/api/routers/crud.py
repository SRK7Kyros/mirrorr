from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from urllib.parse import urlparse

from sqlalchemy.exc import IntegrityError
from sqlalchemy import and_ as sa_and
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
from mirrorr.api.dependencies import _get_db, require_auth, AuthState
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
from mirrorr.storage.models import Session, Autorun, Recording, Profile, Engine, Resolver, ResolverSource, ResourceAccess, ResourceOwnerGroup, ResourceOwnerUser
from mirrorr.services.permissions import group_holds, has_capability
from mirrorr.services.session_helpers import build_session_urls
from mirrorr.storage.enums import SessionStatus, ResourceType, AutorunStatus, Capability
from mirrorr.storage import crud
from mirrorr.storage.models import EventSubscription, Notification

crud_routers = APIRouter()


async def _cleanup_related_records(db: AsyncSession, resource_type: ResourceType, resource_id: int) -> None:
    """Clean up EventSubscription, Notification, grant and owner records for a deleted entity.

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
        sql_delete(ResourceOwnerGroup).where(
            ResourceOwnerGroup.resource_type == resource_type,
            ResourceOwnerGroup.resource_id == resource_id,
        )
    )
    await db.exec(
        sql_delete(ResourceOwnerUser).where(
            ResourceOwnerUser.resource_type == resource_type,
            ResourceOwnerUser.resource_id == resource_id,
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
    """Delete a profile, keeping everything anybody (including its owner) built from it.

    ``profile_id`` is a link to a template, and the row that names it copied its
    engine/resolver/config into its own columns at creation. So no consumer is
    destroyed: a shared profile other users started from is **detached**
    (``profile_id`` cleared, everything else kept) and counted as ``detached``,
    and every autorun built from it is detached **and flagged** with
    ``issue="profile-deleted"`` — a schedule that quietly vanishes leaves a
    recording nobody is told it will miss, so it instead says it needs
    attention, and the scheduler skips it until it is saved again. Counted as
    ``flagged``.

    The owner's own *standalone sessions* still cascade (they describe something
    that already happened), and recordings are detached, not deleted.
    """
    profile = await crud.get_by_id(db, Profile, profile_id)
    owner = (
        getattr(profile, "requester_user_token", None),
        getattr(profile, "requester_group_id", None),
    )

    def derived_by_owner(row) -> bool:
        return (
            getattr(row, "requester_user_token", None),
            getattr(row, "requester_group_id", None),
        ) == owner

    async def detach(rows: list) -> int:
        for row in rows:
            row.profile_id = None
            db.add(row)
        await db.flush()
        return len(rows)

    counts: dict[str, int] = {"profiles": 1}

    # Standalone sessions (not spawned by an autorun)
    sess = (await db.exec(
        select(Session).where(Session.profile_id == profile_id, Session.autorun_id.is_(None))
    )).all()
    own_sess = [s for s in sess if derived_by_owner(s)]
    detached = await detach([s for s in sess if not derived_by_owner(s)])
    for s in own_sess:
        folder = s.session_folder
        sub = await _cascade_delete_session(db, s.id)
        for k, v in sub.items():
            counts[k] = counts.get(k, 0) + v
        await _reclaim_session(s.id, folder)
        await _safe_emit(MirrorrEvent.SESSION_DELETED(id=s.id))
    counts["sessions"] = counts.get("sessions", 0) + len(own_sess)

    flagged = (await db.exec(select(Autorun).where(Autorun.profile_id == profile_id))).all()
    for autorun in flagged:
        autorun.profile_id = None
        autorun.issue = "profile-deleted"
        db.add(autorun)
    await db.flush()
    if detached:
        counts["detached"] = detached
    if flagged:
        counts["flagged"] = len(flagged)

    counts.update(await _count_related_records(db, ResourceType.PROFILE, profile_id))
    await _cleanup_related_records(db, ResourceType.PROFILE, profile_id)
    await _safe_delete(db, Profile, profile_id)
    for autorun in flagged:
        await _safe_emit(MirrorrEvent.AUTORUN_UPDATED(id=autorun.id))
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
    keep their 403 shape while the decision moves to capabilities. Deliberately
    used on **read handlers only** — ``VIEW`` admits reads, never control,
    update, delete, save-as-profile or export/import. The one write it admits is
    ``_load_visible_profile``: pointing a *new* item of your own at an existing
    profile changes nothing on that profile. Authentication is owned by the
    ``require_auth`` dependency, so no anonymous caller reaches a handler.
    """
    return await has_capability(db, auth, obj, Capability.VIEW)


async def _load_visible_profile(
    db: AsyncSession, profile_id: int | None, auth: AuthState
) -> Profile | None:
    """Load a profile a request points at, enforcing ``VIEW``.

    A profile exists to be *used*: a session or an autorun only ever copies from
    it (engine, resolver, config, retry policy land in the new row; the profile
    is never touched), so referencing one is a read of it, and ``VIEW`` is the
    capability for reading an item. The two ``save-as-profile`` routes follow the
    same rule — they copy an item's capture into a profile the caller owns and
    leave the source alone.

    Requiring ``EDIT`` here used to make a profile shared with ``everyone``
    unusable, while protecting nothing: ``ProfileResponse`` already ships the
    same ``resolver_config`` to every ``VIEW`` holder, and a caller may name the
    engine/resolver/config explicitly without a profile at all.
    """
    if profile_id is None:
        return None
    profile = await crud.get_by_id(db, Profile, profile_id)
    if not profile:
        raise HTTPException(status_code=400, detail=f"Profile {profile_id} not found")
    if not await has_capability(db, auth, profile, Capability.VIEW):
        raise HTTPException(status_code=403, detail="Not your profile")
    return profile


async def _load_fallback_chain(
    db: AsyncSession,
    ids: list[int] | None,
    auth: AuthState,
    primary_profile_id: int | None,
    subject: str = "autorun",
) -> list[int]:
    """Validate a fallback chain: all visible, once each, never the primary.

    Each profile is loaded through ``_load_visible_profile`` so a fallback obeys
    the same rule as the primary: using a profile copies out of it, which is a
    read of it. Only reuse of the primary is refused, because the chain advances
    by position and a repeated profile could never advance.
    """
    chain: list[int] = []
    for pid in ids or []:
        if pid == primary_profile_id:
            raise _guard_denied(
                422, f"A fallback cannot be the {subject}'s own profile", "fallback-is-primary"
            )
        if pid in chain:
            raise _guard_denied(422, "A fallback profile is listed twice", "fallback-duplicate")
        await _load_visible_profile(db, pid, auth)
        chain.append(pid)
    return chain


def _source_key(resolver_id: int, config: dict[str, Any] | None) -> str:
    """Identity of one source, so a chain cannot name the same one twice."""
    return f"{resolver_id}:{json.dumps(config or {}, sort_keys=True, default=str)}"


def _usable_sources(
    sources: list[Any] | None, resolver_id: int, resolver_config: dict[str, Any] | None
) -> list[dict[str, Any]]:
    """An inherited chain re-seated against the run's own source.

    Inheriting must never refuse a run whose caller wrote none of the chain, so
    a rung that would repeat the run's own source is dropped here instead of
    raising the way a declared chain does.
    """
    seen = {_source_key(resolver_id, resolver_config)}
    kept: list[dict[str, Any]] = []
    for raw in sources or []:
        key = _source_key(int(raw.get("resolver_id") or 0), raw.get("resolver_config"))
        if key in seen:
            continue
        seen.add(key)
        kept.append({
            "resolver_id": int(raw["resolver_id"]),
            "resolver_config": dict(raw.get("resolver_config") or {}),
        })
    return kept


async def _load_fallback_sources(
    db: AsyncSession,
    sources: list[Any] | None,
    primary_resolver_id: int,
    primary_resolver_config: dict[str, Any] | None,
    subject: str = "autorun",
) -> list[dict[str, Any]]:
    """Validate inline fallback sources: real resolvers, once each, never the primary.

    A source is a resolver plus its config — the same shape the run's own
    engine+resolver capture carries — so a fallback only moves *where* the
    stream comes from, keeping the run's engine and retry policy. Only the
    primary is refused besides repeats, because the chain advances by position
    and a repeated source could never advance.
    """
    chain: list[dict[str, Any]] = []
    seen: set[str] = set()
    primary = _source_key(primary_resolver_id, primary_resolver_config)
    for raw in sources or []:
        if isinstance(raw, dict):
            resolver_id = int(raw.get("resolver_id") or 0)
            config = dict(raw.get("resolver_config") or {})
        else:
            resolver_id = int(raw.resolver_id)
            config = dict(raw.resolver_config or {})
        key = _source_key(resolver_id, config)
        if key == primary:
            raise _guard_denied(
                422, f"A fallback cannot be the {subject}'s own source", "fallback-source-is-primary"
            )
        if key in seen:
            raise _guard_denied(422, "A fallback source is listed twice", "fallback-source-duplicate")
        if not await crud.get_by_id(db, Resolver, resolver_id):
            raise HTTPException(status_code=400, detail=f"Resolver {resolver_id} not found")
        seen.add(key)
        chain.append({"resolver_id": resolver_id, "resolver_config": config})
    return chain


async def _chain_for_run(
    db: AsyncSession,
    declared: list[Any] | None,
    profile: Profile | None,
    resolver_id: int,
    resolver_config: dict[str, Any] | None,
    subject: str = "autorun",
) -> list[dict[str, Any]]:
    """The chain a run starts with: the one it declared, else its profile's.

    A declared list is the chain even when it is empty — clearing the chain in a
    request that also names a profile must not be undone by that profile's own.
    Only a request that says nothing about the chain inherits it.
    """
    if declared is None:
        declared = _usable_sources(
            profile.fallback_sources if profile is not None else None,
            resolver_id,
            resolver_config,
        )
    return await _load_fallback_sources(db, declared, resolver_id, resolver_config, subject=subject)


def _capture_plan(
    profile_id: int | None,
    fallbacks: list[int],
    sources: list[dict[str, Any]],
) -> list[int | dict[str, Any] | None]:
    """The ordered captures a run tries: its own source first, then the fallbacks.

    ``None`` is the supervisor's "run the row's own engine + resolver" capture,
    which a request naming no profile needs as its first entry.
    """
    if profile_id is not None:
        return [profile_id, *fallbacks, *sources]
    if not fallbacks and not sources:
        return []
    return [None, *fallbacks, *sources]


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
    where_expr=None,
) -> dict:
    """Cursor-based pagination filtered by owner, an explicit grant, or ownership by a user or group.

    A caller sees the rows they own (``requester_user_token``), any row carrying a
    grant for them — directly or through one of their groups, the reserved
    ``everyone`` group included — and any row any of their owner rows names them
    on (an owner user or a group they belong to). VIEW is the base capability, so
    *any* grant admits the row and the grant EXISTS deliberately does not filter
    on ``capability``. A row whose primary owner is a *group* the caller belongs
    to admits them the same way (the ``everyone`` group included), so a crown
    handed to a group shows that group's work to its members. Engines/resolvers
    have no owner column and never route through here.

    ``where_expr`` narrows the collection further (e.g. ``Session.autorun_id``)
    and is combined with the access predicate rather than replacing it.

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
                sa_or(
                    ResourceAccess.username == user_token,
                    group_holds(user_token, ResourceAccess.group_id),
                ),
            )
            .exists()
        )
        owned_by_group = (
            select(ResourceOwnerGroup.id)
            .where(
                ResourceOwnerGroup.resource_type == resource_type,
                ResourceOwnerGroup.resource_id == model.id,
                group_holds(user_token, ResourceOwnerGroup.group_id),
            )
            .exists()
        )
        owned_by_user = (
            select(ResourceOwnerUser.id)
            .where(
                ResourceOwnerUser.resource_type == resource_type,
                ResourceOwnerUser.resource_id == model.id,
                ResourceOwnerUser.username == user_token,
            )
            .exists()
        )
        predicate = sa_or(
            owner_match,
            group_holds(user_token, model.requester_group_id),
            granted,
            owned_by_group,
            owned_by_user,
        )
    scope = predicate if where_expr is None else sa_and(predicate, where_expr)
    stmt = select(model).where(scope)
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
        total = await crud.count(db, model, scope)
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


def _serialize_autorun(a: Autorun, fallback_names: dict[int, str] | None = None) -> dict:
    chain = a.fallback_profile_ids or []
    names = fallback_names or {}
    return {
        **a.model_dump(mode="json"),
        "fallback_profile_ids": chain,
        "fallback_profile_names": [names.get(pid, "") for pid in chain],
        "fallback_sources": a.fallback_sources or [],
        "engine_name": _name_of(getattr(a, "engine", None)),
        "resolver_name": _name_of(getattr(a, "resolver", None)),
        "profile_name": _name_of(getattr(a, "profile", None)),
    }


async def _fallback_names(db: AsyncSession, rows: list[Autorun]) -> dict[int, str]:
    ids = {pid for row in rows for pid in (row.fallback_profile_ids or [])}
    if not ids:
        return {}
    return dict((await db.exec(select(Profile.id, Profile.name).where(Profile.id.in_(ids)))).all())


def _serialize_profile(p: Profile) -> dict:
    return {
        **p.model_dump(mode="json"),
        "fallback_sources": list(p.fallback_sources or []),
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
    db: AsyncSession = Depends(_get_db),
    auth: AuthState = Depends(require_auth),
    cursor: int | None = Query(None, description="ID of last item from previous page"),
    limit: int = Query(50, ge=1, le=200, description="Items per page"),
    include_total: bool = Query(False, description="Include a total row count in the response"),
    autorun: int | None = Query(None, description="Only sessions spawned by this autorun"),
):
    """List sessions, newest first.

    ``?autorun=<id>`` narrows the list to the runs one scheduled recording
    spawned, so a caller never has to page through the whole history to find
    them. Access still applies: the filter narrows what the caller may see.
    """
    where_expr = Session.autorun_id == autorun if autorun is not None else None
    total = None
    if auth.is_admin:
        result = await crud.get_all_paginated(
            db, Session, cursor=cursor, limit=limit, options=_SESSION_OPTIONS, where_expr=where_expr,
        )
        if include_total:
            total = await crud.count(db, Session, where_expr)
    else:
        result = await _get_paginated_for_user(
            db, Session, auth.user.username, cursor=cursor, limit=limit, options=_SESSION_OPTIONS,
            include_total=include_total, where_expr=where_expr,
        )
        total = result.get("total") if isinstance(result, dict) else None
    data = _paginate_response(result)
    if isinstance(data.get("items"), list):
        data["items"] = [_serialize_session(i) for i in data["items"]]
    return {**data, "total": total}


@sessions_router.get("/{id}", response_model=SessionResponse)
async def get_session(id: int, db: AsyncSession = Depends(_get_db), auth: AuthState = Depends(require_auth)):
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
async def create_session(item: CreateSessionRequest, db: AsyncSession = Depends(_get_db), auth: AuthState = Depends(require_auth)):
    profile = await _load_visible_profile(db, item.profile_id, auth)
    engine_id, resolver_id, resolver_config, retry_mode, retry_config = _resolve_capture_target(
        profile, item.engine_id, item.resolver_id, item.resolver_config, item.retry_mode, item.retry_config
    )
    fallbacks = await _load_fallback_chain(
        db, item.fallback_profile_ids, auth, item.profile_id, subject="session"
    )
    sources = await _chain_for_run(
        db, item.fallback_sources, profile, resolver_id, resolver_config, subject="session"
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
        capture_plan=_capture_plan(item.profile_id, fallbacks, sources),
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
async def delete_session(id: int, db: AsyncSession = Depends(_get_db), auth: AuthState = Depends(require_auth)):
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
    db: AsyncSession = Depends(_get_db),
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
        fallback_names = await _fallback_names(db, data["items"])
        data["items"] = [_serialize_autorun(i, fallback_names) for i in data["items"]]
    return {**data, "total": total}


@autoruns_router.get("/{id}", response_model=AutorunResponse)
async def get_autorun(id: int, db: AsyncSession = Depends(_get_db), auth: AuthState = Depends(require_auth)):
    item = await crud.get_by_id(db, Autorun, id, options=_AUTORUN_OPTIONS)
    if not item:
        raise HTTPException(status_code=404, detail="Autorun not found")
    if not await _require_read_access(db, auth, item):
        raise HTTPException(status_code=403, detail="Not your autorun")
    return _serialize_autorun(item, await _fallback_names(db, [item]))


@autoruns_router.post("/", response_model=AutorunResponse)
async def create_autorun(item: CreateAutorunRequest, db: AsyncSession = Depends(_get_db), auth: AuthState = Depends(require_auth)):
    profile = await _load_visible_profile(db, item.profile_id, auth)
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
    start_time = _naive_utc(item.start_time)
    end_time = _naive_utc(item.end_time)
    if end_time <= start_time:
        raise _guard_denied(422, "End must be after start", "end-before-start")
    payload = Autorun(
        user_friendly_name=item.user_friendly_name,
        snake_case_name=item.snake_case_name,
        profile_id=item.profile_id,
        engine_id=engine_id,
        resolver_id=resolver_id,
        resolver_config=resolver_config,
        retry_mode=retry_mode,
        retry_config=retry_config,
        start_time=start_time,
        end_time=end_time,
        recording=item.recording,
        orphan_policy=item.orphan_policy,
        fallback_profile_ids=await _load_fallback_chain(
            db, item.fallback_profile_ids, auth, item.profile_id
        ),
        fallback_sources=await _chain_for_run(
            db, item.fallback_sources, profile, resolver_id, resolver_config
        ),
        requester_user_token=auth.user.username,
        next_run_at=start_time,
    )
    try:
        obj = await crud.create(db, payload)
    except IntegrityError as e:
        raise HTTPException(status_code=400, detail="A resource with that name already exists.")
    await subscribe_requester(db, payload.requester_user_token, ResourceType.AUTORUN, obj.id)
    await _safe_emit(MirrorrEvent.AUTORUN_CREATED(id=obj.id))
    enriched = await crud.get_by_id(db, Autorun, obj.id, options=_AUTORUN_OPTIONS)
    return _serialize_autorun(enriched, await _fallback_names(db, [enriched])) if enriched else obj


@autoruns_router.put("/{id}", response_model=AutorunResponse)
async def update_autorun(id: int, item: UpdateAutorunRequest, db: AsyncSession = Depends(_get_db), auth: AuthState = Depends(require_auth)):
    existing = await crud.get_by_id(db, Autorun, id)
    if not existing:
        raise HTTPException(status_code=404, detail="Autorun not found")
    if not await has_capability(db, auth, existing, Capability.EDIT):
        raise HTTPException(status_code=403, detail="Not your autorun")
    payload_data = item.model_dump(exclude_unset=True)
    profile: Profile | None = None
    if "profile_id" in payload_data:
        profile = await _load_visible_profile(db, payload_data["profile_id"], auth)
        payload_data = _merge_profile_capture(profile, payload_data)
    if "fallback_profile_ids" in payload_data:
        payload_data["fallback_profile_ids"] = await _load_fallback_chain(
            db,
            payload_data["fallback_profile_ids"],
            auth,
            payload_data.get("profile_id", existing.profile_id),
        )
    declared = payload_data.pop("fallback_sources", None)
    if declared is not None or profile is not None:
        payload_data["fallback_sources"] = await _chain_for_run(
            db,
            declared,
            profile,
            payload_data.get("resolver_id", existing.resolver_id),
            payload_data.get("resolver_config", existing.resolver_config),
        )
    _enforce_autorun_update_guard(existing, payload_data)
    for field in ("start_time", "end_time"):
        if payload_data.get(field) is not None:
            payload_data[field] = _naive_utc(payload_data[field])
    if "start_time" in payload_data and existing.status == AutorunStatus.SCHEDULED:
        payload_data["next_run_at"] = payload_data["start_time"]
    # Re-saving a flagged schedule is the acknowledgement that clears its issue.
    payload_data["issue"] = None
    fresh = await crud.get_by_id(db, Autorun, id)
    if not fresh:
        raise HTTPException(status_code=404, detail="Autorun not found")
    if fresh.status != existing.status:
        raise _guard_denied(409, "Autorun status changed while editing", "status-race")
    payload = Autorun.model_validate({**fresh.model_dump(), **payload_data})
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
    return _serialize_autorun(enriched, await _fallback_names(db, [enriched])) if enriched else obj


@autoruns_router.delete("/{id}", response_model=DeleteResultResponse)
async def delete_autorun(id: int, db: AsyncSession = Depends(_get_db), auth: AuthState = Depends(require_auth)):
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
    fallback_sources: list[Any] | None = None,
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
        fallback_sources=_usable_sources(fallback_sources, resolver_id, resolver_config),
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
async def save_autorun_as_profile(autorun_id: int, req: SaveProfileRequest, db: AsyncSession = Depends(_get_db), auth: AuthState = Depends(require_auth)):
    autorun = await crud.get_by_id(db, Autorun, autorun_id)
    if not autorun:
        raise HTTPException(status_code=404, detail="Autorun not found")
    if not await has_capability(db, auth, autorun, Capability.VIEW):
        raise HTTPException(status_code=403, detail="Not your autorun")
    return await _create_profile_from_entity(
        db, auth, req.name,
        autorun.engine_id, autorun.resolver_id, autorun.resolver_config,
        autorun.retry_mode, autorun.retry_config,
        autorun.fallback_sources,
    )


crud_routers.include_router(autoruns_router)

# ── Save Session as Profile ────────────────────────────────────────────


@crud_routers.post("/sessions/{session_id}/save-as-profile")
async def save_session_as_profile(session_id: int, req: SaveProfileRequest, db: AsyncSession = Depends(_get_db), auth: AuthState = Depends(require_auth)):
    session = await crud.get_by_id(db, Session, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if not await has_capability(db, auth, session, Capability.VIEW):
        raise HTTPException(status_code=403, detail="Not your session")
    return await _create_profile_from_entity(
        db, auth, req.name,
        session.engine_id, session.resolver_id, session.resolver_config,
        session.retry_mode, session.retry_config,
        [entry for entry in (session.capture_plan or []) if isinstance(entry, dict)],
    )


# ── Recordings ─────────────────────────────────────────────────────────

recordings_router = APIRouter(prefix="/recordings", route_class=PrivilegedRoute)


@recordings_router.get("/", response_model=RecordingListResponse)
async def get_all_recordings(
    db: AsyncSession = Depends(_get_db),
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
async def get_recording(id: int, db: AsyncSession = Depends(_get_db), auth: AuthState = Depends(require_auth)):
    item = await crud.get_by_id(db, Recording, id)
    if not item:
        raise HTTPException(status_code=404, detail="Recording not found")
    if not await _require_read_access(db, auth, item):
        raise HTTPException(status_code=403, detail="Not your recording")
    return _serialize_recording(item)


@recordings_router.delete("/{id}", response_model=DeleteResultResponse)
async def delete_recording(id: int, db: AsyncSession = Depends(_get_db), auth: AuthState = Depends(require_auth)):
    obj = await crud.get_by_id(db, Recording, id)
    if not obj:
        raise HTTPException(status_code=404, detail="Not found")
    if not await has_capability(db, auth, obj, Capability.DELETE):
        raise HTTPException(status_code=403, detail="Not your recording")

    counts = await _count_related_records(db, ResourceType.RECORDING, id)
    await _cleanup_related_records(db, ResourceType.RECORDING, id)
    disk_path = obj.disk_path
    await _safe_delete(db, Recording, id)
    # The row is gone before the folder: remove_session_folder's guard reads the
    # kept rows, and this recording must not block its own removal.
    from mirrorr.di import container
    from mirrorr.services.session_lifecycle import remove_recording_folder

    await remove_recording_folder(container.settings, disk_path)
    await _safe_emit(MirrorrEvent.RECORDING_DELETED(id=id))
    return DeleteResultResponse(status="deleted", deleted=counts)


crud_routers.include_router(recordings_router)

# ── Profiles ───────────────────────────────────────────────────────────

profiles_router = APIRouter(prefix="/profiles", route_class=PrivilegedRoute)


@profiles_router.get("/", response_model=ProfileListResponse)
async def get_all_profiles(
    db: AsyncSession = Depends(_get_db),
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
async def get_profile(id: int, db: AsyncSession = Depends(_get_db), auth: AuthState = Depends(require_auth)):
    item = await crud.get_by_id(db, Profile, id, options=_PROFILE_OPTIONS)
    if not item:
        raise HTTPException(status_code=404, detail="Profile not found")
    if not await _require_read_access(db, auth, item):
        raise HTTPException(status_code=403, detail="Not your profile")
    return _serialize_profile(item)


@profiles_router.post("/", response_model=ProfileResponse)
async def create_profile(item: CreateProfileRequest, db: AsyncSession = Depends(_get_db), auth: AuthState = Depends(require_auth)):
    # Validate FK references exist
    engine = await crud.get_by_id(db, Engine, item.default_engine_id)
    if not engine:
        raise HTTPException(status_code=400, detail=f"Engine {item.default_engine_id} not found")
    resolver = await crud.get_by_id(db, Resolver, item.resolver_id)
    if not resolver:
        raise HTTPException(status_code=400, detail=f"Resolver {item.resolver_id} not found")

    # The chain is set below; dumping it would validate ``None`` against a list column.
    payload = Profile.model_validate(item.model_dump(exclude={"fallback_sources"}))
    payload.fallback_sources = await _load_fallback_sources(
        db, item.fallback_sources, item.resolver_id, item.resolver_config, subject="profile"
    )
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
async def update_profile(id: int, item: UpdateProfileRequest, db: AsyncSession = Depends(_get_db), auth: AuthState = Depends(require_auth)):
    existing = await crud.get_by_id(db, Profile, id)
    if not existing:
        raise HTTPException(status_code=404, detail="Profile not found")
    if not await has_capability(db, auth, existing, Capability.EDIT):
        raise HTTPException(status_code=403, detail="Not your profile")
    payload_data = item.model_dump(exclude_unset=True)
    if payload_data.get("fallback_sources", []) is None:
        payload_data.pop("fallback_sources")
    current = existing.model_dump()
    current["fallback_sources"] = existing.fallback_sources or []
    payload = Profile.model_validate({**current, **payload_data})
    payload.fallback_sources = await _load_fallback_sources(
        db, payload.fallback_sources, payload.resolver_id, payload.resolver_config, subject="profile"
    )
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
async def delete_profile(id: int, db: AsyncSession = Depends(_get_db), auth: AuthState = Depends(require_auth)):
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
    db: AsyncSession = Depends(_get_db),
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
async def get_source(id: int, db: AsyncSession = Depends(_get_db), auth: AuthState = Depends(require_auth)):
    item = await crud.get_by_id(db, ResolverSource, id, options=_SOURCE_OPTIONS)
    if not item:
        raise HTTPException(status_code=404, detail="Source not found")
    if not await _require_read_access(db, auth, item):
        raise HTTPException(status_code=403, detail="Not your source")
    return _serialize_source(item)


@sources_router.post("/", response_model=ResolverSourceResponse)
async def create_source(item: CreateResolverSourceRequest, db: AsyncSession = Depends(_get_db), auth: AuthState = Depends(require_auth)):
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
async def update_source(id: int, item: UpdateResolverSourceRequest, db: AsyncSession = Depends(_get_db), auth: AuthState = Depends(require_auth)):
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
async def delete_source(id: int, db: AsyncSession = Depends(_get_db), auth: AuthState = Depends(require_auth)):
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
    db: AsyncSession = Depends(_get_db),
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
async def get_engine(id: int, db: AsyncSession = Depends(_get_db), _auth: AuthState = Depends(require_auth)):
    item = await crud.get_by_id(db, Engine, id)
    if not item:
        raise HTTPException(status_code=404, detail="Engine not found")
    return _serialize_engine(item)


crud_routers.include_router(engines_router)

# ── Resolvers ──────────────────────────────────────────────────────────

resolvers_router = APIRouter(prefix="/resolvers")


@resolvers_router.get("/", response_model=ResolverListResponse)
async def get_all_resolvers(
    db: AsyncSession = Depends(_get_db),
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
async def get_resolver(id: int, db: AsyncSession = Depends(_get_db), _auth: AuthState = Depends(require_auth)):
    item = await crud.get_by_id(db, Resolver, id)
    if not item:
        raise HTTPException(status_code=404, detail="Resolver not found")
    return item


@resolvers_router.post("/{id}/discover", response_model=DiscoveryResponse)
async def discover_resolver(
    id: int,
    body: DiscoveryRequest,
    db: AsyncSession = Depends(_get_db),
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
async def stop_session(session_id: int, auth: AuthState = Depends(require_auth), db: AsyncSession = Depends(_get_db)):
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
async def enable_recording(session_id: int, auth: AuthState = Depends(require_auth), db: AsyncSession = Depends(_get_db)):
    await _require_session_owner(session_id, auth, db)
    return await _send_control(session_id, "enable_recording")


@session_control_router.post("/{session_id}/recording/disable")
async def disable_recording(session_id: int, auth: AuthState = Depends(require_auth), db: AsyncSession = Depends(_get_db)):
    await _require_session_owner(session_id, auth, db)
    return await _send_control(session_id, "disable_recording")
