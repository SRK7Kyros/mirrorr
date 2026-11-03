"""Capability checks for owner-bearing resources.

The single predicate every router calls. Owner and admin hold all six
capabilities implicitly; everyone else holds exactly the capabilities granted
in ``resource_access``. Engines and resolvers are ownerless system rows — no
owner, no grants — so they are outside this predicate and gated by
authentication alone.
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import literal, or_
from sqlalchemy.orm import aliased
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
    ResourceOwnerUser,
    Session,
    User,
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

# A session answers to its autorun **live** — the same question is asked of the
# schedule the run came from, so a share added there reaches the runs it already
# produced and a revoked one takes them away. Nothing is copied onto the session.
_ACCESS_PARENT: dict[type, type] = {Session: Autorun}


async def _parent_of(db: AsyncSession, obj):
    """The row *obj* also answers to, if any — a session's autorun."""
    parent_model = _ACCESS_PARENT.get(type(obj))
    parent_id = getattr(obj, "autorun_id", None)
    if parent_model is None or parent_id is None:
        return None
    return await db.get(parent_model, parent_id)


async def _holds(
    db: AsyncSession, username: str, obj, capability: Capability
) -> bool:
    """Whether *username* holds *capability* through *obj*'s own rows."""
    resource_type = _ACCESS_MODEL_TYPES.get(type(obj))
    if resource_type is None:
        return False  # system row: no owner, no grants
    if getattr(obj, "requester_user_token", None) == username:
        return True
    # The primary owner may be a group: every member then holds all six, and the
    # reserved ``everyone`` group means every authenticated user (``group_holds``
    # owns that rule, so the two kinds of owner cannot drift apart).
    primary_group = getattr(obj, "requester_group_id", None)
    if primary_group is not None:
        held = select(literal(1)).where(group_holds(username, literal(primary_group)))
        if (await db.exec(held)).first() is not None:
            return True
    owner_user = select(ResourceOwnerUser.id).where(
        ResourceOwnerUser.resource_type == resource_type,
        ResourceOwnerUser.resource_id == obj.id,
        ResourceOwnerUser.username == username,
    )
    if (await db.exec(owner_user)).first() is not None:
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
    authenticated user"), and any owner row — a user owner or an owner group —
    confers all six, exactly like the requester.

    A resource with a live parent (a session's autorun) is also asked of that
    parent, so the schedule's sharing governs its runs as it stands *now*.
    """
    if _ACCESS_MODEL_TYPES.get(type(obj)) is None:
        return False  # system row: no owner, no grants
    if auth.is_admin:
        return True
    if not auth.user:
        return False
    username = auth.user.username
    if await _holds(db, username, obj, capability):
        return True
    parent = await _parent_of(db, obj)
    return parent is not None and await _holds(db, username, parent, capability)


async def viewer_usernames(
    db: AsyncSession, resource_type: ResourceType, resource_id: int
) -> frozenset[str] | None:
    """Every username that may VIEW one resource, or ``None`` when it is gone.

    The socket layer's audience. It expands the same rows ``has_capability``
    consults — the requester owner (a user or a group), owner users, owner
    groups, and **any** grant — into user names, so a live event reaches exactly
    the users an authenticated GET would serve it to.

    Admins are absent on purpose: they hold everything implicitly, and the
    caller short-circuits them instead of enumerating every account.
    """
    model = next(
        (m for m, rt in _ACCESS_MODEL_TYPES.items() if rt is resource_type), None
    )
    obj = await db.get(model, resource_id) if model is not None else None
    if obj is None:
        return None

    usernames: set[str] = set()
    if obj.requester_user_token:
        usernames.add(obj.requester_user_token)
    usernames.update(
        (
            await db.exec(
                select(ResourceOwnerUser.username).where(
                    ResourceOwnerUser.resource_type == resource_type,
                    ResourceOwnerUser.resource_id == resource_id,
                )
            )
        ).all()
    )

    groups: set[int] = set()
    if obj.requester_group_id is not None:
        groups.add(obj.requester_group_id)
    groups.update(
        (
            await db.exec(
                select(ResourceOwnerGroup.group_id).where(
                    ResourceOwnerGroup.resource_type == resource_type,
                    ResourceOwnerGroup.resource_id == resource_id,
                )
            )
        ).all()
    )
    for username, group_id in (
        await db.exec(
            select(ResourceAccess.username, ResourceAccess.group_id).where(
                ResourceAccess.resource_type == resource_type,
                ResourceAccess.resource_id == resource_id,
            )
        )
    ).all():
        if username:
            usernames.add(username)
        if group_id is not None:
            groups.add(group_id)

    if groups:
        everyone_id = (
            await db.exec(select(Group.id).where(Group.system.is_(True)))
        ).first()
        if everyone_id in groups:
            usernames.update((await db.exec(select(User.username))).all())
        else:
            usernames.update(
                (
                    await db.exec(
                        select(GroupMember.username).where(
                            GroupMember.group_id.in_(groups)
                        )
                    )
                ).all()
            )
    parent_model = _ACCESS_PARENT.get(model)
    parent_id = getattr(obj, "autorun_id", None)
    if parent_model is not None and parent_id is not None:
        inherited = await viewer_usernames(
            db, _ACCESS_MODEL_TYPES[parent_model], parent_id
        )
        if inherited:
            usernames |= inherited
    return frozenset(usernames)


async def inherit_access(db: AsyncSession, source, target) -> int:
    """Copy *source*'s grants and owner rows onto *target*, returning the rows added.

    A session follows its autorun live (``_ACCESS_PARENT``) and needs no copy;
    this materialises access for a resource that outlives its source — a
    recording keeps what the run could see when it finished. Rows the target
    already holds are skipped, so two sources can feed one target.
    """
    source_type = _ACCESS_MODEL_TYPES[type(source)]
    target_type = _ACCESS_MODEL_TYPES[type(target)]
    grants = (
        await db.exec(
            select(ResourceAccess).where(
                ResourceAccess.resource_type == source_type,
                ResourceAccess.resource_id == source.id,
            )
        )
    ).all()
    owner_groups = (
        await db.exec(
            select(ResourceOwnerGroup).where(
                ResourceOwnerGroup.resource_type == source_type,
                ResourceOwnerGroup.resource_id == source.id,
            )
        )
    ).all()
    owner_users = (
        await db.exec(
            select(ResourceOwnerUser).where(
                ResourceOwnerUser.resource_type == source_type,
                ResourceOwnerUser.resource_id == source.id,
            )
        )
    ).all()

    held = {
        (row.username, row.group_id, row.capability)
        for row in (
            await db.exec(
                select(ResourceAccess).where(
                    ResourceAccess.resource_type == target_type,
                    ResourceAccess.resource_id == target.id,
                )
            )
        ).all()
    }
    held_groups = {
        row.group_id
        for row in (
            await db.exec(
                select(ResourceOwnerGroup).where(
                    ResourceOwnerGroup.resource_type == target_type,
                    ResourceOwnerGroup.resource_id == target.id,
                )
            )
        ).all()
    }
    held_users = {
        row.username
        for row in (
            await db.exec(
                select(ResourceOwnerUser).where(
                    ResourceOwnerUser.resource_type == target_type,
                    ResourceOwnerUser.resource_id == target.id,
                )
            )
        ).all()
    }

    added = 0
    for row in grants:
        key = (row.username, row.group_id, row.capability)
        if key in held:
            continue
        held.add(key)
        db.add(
            ResourceAccess(
                resource_type=target_type,
                resource_id=target.id,
                username=row.username,
                group_id=row.group_id,
                capability=row.capability,
            )
        )
        added += 1
    for row in owner_groups:
        if row.group_id in held_groups:
            continue
        held_groups.add(row.group_id)
        db.add(
            ResourceOwnerGroup(
                resource_type=target_type, resource_id=target.id, group_id=row.group_id
            )
        )
        added += 1
    for row in owner_users:
        if row.username in held_users:
            continue
        held_users.add(row.username)
        db.add(
            ResourceOwnerUser(
                resource_type=target_type, resource_id=target.id, username=row.username
            )
        )
        added += 1
    return added


async def inherit_effective_access(db: AsyncSession, source, target) -> int:
    """Materialise what *source* answers to onto *target* — own rows and live parent alike.

    A recording outlives the session that produced it, so it cannot follow that
    session live the way the session follows its autorun: it keeps what the run
    could see when it finished.
    """
    added = await inherit_access(db, source, target)
    parent = await _parent_of(db, source)
    if parent is not None:
        added += await inherit_access(db, parent, target)
    return added


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


def _row_predicate(model, resource_type: ResourceType | None, user_token: str):
    """SQL predicate over *model*'s own owner, owner rows and grants."""
    owner_match = model.requester_user_token == user_token
    if resource_type is None:
        return owner_match
    granted = (
        select(ResourceAccess.id)
        .where(
            ResourceAccess.resource_type == resource_type,
            ResourceAccess.resource_id == model.id,
            or_(
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
    return or_(
        owner_match,
        group_holds(user_token, model.requester_group_id),
        granted,
        owned_by_group,
        owned_by_user,
    )


def access_predicate(model, user_token: str):
    """SQL predicate: the rows of *model* that *user_token* may see.

    The filter every owner-bearing list is paginated through — a row the caller
    owns, a row carrying a grant for them (directly or through one of their
    groups, the reserved ``everyone`` group included), and a row any of their
    owner rows names them on. VIEW is the base capability, so *any* grant
    admits the row and the grant EXISTS deliberately does not filter on
    ``capability``; a crown handed to a group admits that group's members.

    Shared by the paginated lists and the console's counts, so a number and the
    list it describes can never disagree about what a caller holds. A model
    with no owner column (engines, resolvers) answers the bare owner match —
    they are ownerless system rows and never route through here.

    A session also admits whoever its autorun admits *now*, which is the same
    live rule ``has_capability`` applies, so a list and a detail page agree.
    """
    own = _row_predicate(model, _ACCESS_MODEL_TYPES.get(model), user_token)
    parent_model = _ACCESS_PARENT.get(model)
    if parent_model is None:
        return own
    parent = aliased(parent_model)
    inherited = (
        select(literal(1))
        .where(
            model.autorun_id == parent.id,
            _row_predicate(parent, _ACCESS_MODEL_TYPES[parent_model], user_token),
        )
        .exists()
    )
    return or_(own, inherited)


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
