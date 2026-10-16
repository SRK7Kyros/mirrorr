"""Capability checks for owner-bearing resources.

The single predicate every router calls. Owner and admin hold all six
capabilities implicitly; everyone else holds exactly the capabilities granted
in ``resource_access``. Engines and resolvers are ownerless system rows — no
owner, no grants — so they are outside this predicate and gated by
authentication alone.
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from mirrorr.api.dependencies import AuthState
from mirrorr.storage.enums import Capability, ResourceType
from mirrorr.storage.models import (
    Autorun,
    Profile,
    Recording,
    ResolverSource,
    ResourceAccess,
    Session,
)

# Owner-bearing resource kinds a grant can point at. Engines and resolvers are
# absent on purpose: they are ownerless system rows.
_ACCESS_MODEL_TYPES: dict[type, ResourceType] = {
    Session: ResourceType.SESSION,
    Autorun: ResourceType.AUTORUN,
    Recording: ResourceType.RECORDING,
    Profile: ResourceType.PROFILE,
    ResolverSource: ResourceType.SOURCE,
}


async def has_capability(
    db: AsyncSession, auth: AuthState, obj, capability: Capability
) -> bool:
    """True when *auth* may perform *capability* on *obj*. Never raises."""
    resource_type = _ACCESS_MODEL_TYPES.get(type(obj))
    if resource_type is None:
        return False  # system row: no owner, no grants
    if auth.is_admin:
        return True
    if not auth.user:
        return False
    if getattr(obj, "requester_user_token", None) == auth.user.username:
        return True
    stmt = select(ResourceAccess.id).where(
        ResourceAccess.resource_type == resource_type,
        ResourceAccess.resource_id == obj.id,
        ResourceAccess.username == auth.user.username,
        ResourceAccess.capability == capability,
    )
    return (await db.exec(stmt)).first() is not None


async def require_capability(
    db: AsyncSession, auth: AuthState, obj, capability: Capability
) -> None:
    """Raise 401 when unauthenticated, 403 when *capability* is not held.

    Mirrors ``_require_owner_or_admin``: admin short-circuits, and an
    unauthenticated caller is rejected before any ownership check.
    """
    if auth.is_admin:
        return
    if not auth.user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not await has_capability(db, auth, obj, capability):
        raise HTTPException(
            status_code=403, detail=f"Missing capability: {capability.name}"
        )
