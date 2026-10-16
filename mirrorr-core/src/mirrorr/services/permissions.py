"""Capability checks for owner-bearing resources.

The single predicate every router calls. Owner and admin hold all six
capabilities implicitly; everyone else holds exactly the capabilities granted
in ``resource_access``. Engines and resolvers are ownerless system rows — no
owner, no grants — so they are outside this predicate and gated by
authentication alone.
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import or_
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from mirrorr.api.dependencies import AuthState
from mirrorr.storage.enums import Capability, ResourceType
from mirrorr.storage.models import (
    Autorun,
    Group,
    GroupMember,
    Profile,
    Recording,
    ResolverSource,
    ResourceAccess,
    ResourceOwnerGroup,
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
    """True when *auth* may perform *capability* on *obj*. Never raises.

    VIEW is the base capability: any grant on the item implies it, so a VIEW
    check passes on the presence of *any* row while every other capability is
    matched exactly. The implication lives here, in the one predicate, so every
    VIEW-gated route inherits it.

    Principals are users *and* groups: a grant counts when it names the caller
    or a group they belong to (the reserved ``everyone`` group meaning "every
    authenticated user"), and an owner *group* confers all six, exactly like
    the single user owner.
    """
    resource_type = _ACCESS_MODEL_TYPES.get(type(obj))
    if resource_type is None:
        return False  # system row: no owner, no grants
    if auth.is_admin:
        return True
    if not auth.user:
        return False
    username = auth.user.username
    if getattr(obj, "requester_user_token", None) == username:
        return True
    owner_group = select(ResourceOwnerGroup.id).where(
        ResourceOwnerGroup.resource_type == resource_type,
        ResourceOwnerGroup.resource_id == obj.id,
        group_holds(username, ResourceOwnerGroup.group_id),
    )
    if (await db.exec(owner_group)).first() is not None:
        return True
    stmt = select(ResourceAccess.id).where(
        ResourceAccess.resource_type == resource_type,
        ResourceAccess.resource_id == obj.id,
        or_(
            ResourceAccess.username == username,
            group_holds(username, ResourceAccess.group_id),
        ),
    )
    if capability is not Capability.VIEW:
        stmt = stmt.where(ResourceAccess.capability == capability)
    return (await db.exec(stmt)).first() is not None


def group_holds(username: str, group_id_column):
    """SQL predicate: *group_id_column* names a group that holds *username*.

    True for a group the user is a member of, and for the reserved ``everyone``
    group, whose membership is implicit and so never materialised in
    ``group_members``. The everyone row is found by its ``system`` flag rather
    than a hardcoded id, so a re-seeded database stays correct.
    """
    return or_(
        group_id_column == select(Group.id).where(Group.system.is_(True)).scalar_subquery(),
        group_id_column.in_(select(GroupMember.group_id).where(GroupMember.username == username)),
    )


async def require_capability(
    db: AsyncSession, auth: AuthState, obj, capability: Capability
) -> None:
    """Raise 401 when unauthenticated, 403 when *capability* is not held.

    The raising counterpart to ``has_capability``: admin short-circuits, and an
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
