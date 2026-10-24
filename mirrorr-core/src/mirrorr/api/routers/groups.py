"""Group CRUD (admin-only): named sets of users that own items and hold grants.

The reserved ``everyone`` group is seeded by ``ensure_db`` and has no member
rows — membership is implicit, resolved in the permission predicate — so it can
never be renamed, deleted or have its members replaced. Deleting a group drops,
in one transaction, its memberships, its grants and its owner-group rows.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlmodel import col as sa_col, delete as sql_delete, select
from sqlmodel.ext.asyncio.session import AsyncSession

from mirrorr.api.dependencies import _get_db, require_admin
from mirrorr.api.schemas import (
    CreateGroupRequest,
    DeleteGroupResponse,
    GroupListResponse,
    GroupResponse,
    SetMembersRequest,
    UpdateGroupRequest,
)
from mirrorr.storage.models import (
    EVERYONE_GROUP_NAME,
    Group,
    GroupMember,
    ResourceAccess,
    ResourceOwnerGroup,
    User,
)

groups_router = APIRouter(prefix="/groups", dependencies=[Depends(require_admin)])


async def load_group(db: AsyncSession, group_id: int) -> Group:
    group = await db.get(Group, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    return group


async def _usernames(db: AsyncSession) -> list[str]:
    return sorted((await db.exec(select(User.username))).all())


async def _members(db: AsyncSession, group: Group, usernames: list[str]) -> list[str]:
    if group.system:
        return usernames
    return sorted(
        (await db.exec(select(GroupMember.username).where(GroupMember.group_id == group.id))).all()
    )


async def _group_view(db: AsyncSession, group: Group, usernames: list[str]) -> GroupResponse:
    members = await _members(db, group, usernames)
    return GroupResponse(
        id=group.id,
        name=group.name,
        display_name=group.display_name,
        system=group.system,
        member_count=len(members),
        members=members,
    )


def _clean_name(name: str) -> str:
    name = name.strip()
    if not 1 <= len(name) <= 64:
        raise HTTPException(status_code=400, detail="Group name must be 1 to 64 characters")
    if name == EVERYONE_GROUP_NAME:
        raise HTTPException(status_code=409, detail="Group name is reserved")
    return name


def _reserved(action: str) -> HTTPException:
    return HTTPException(status_code=400, detail=f"The reserved group cannot be {action}")


@groups_router.get("", response_model=GroupListResponse)
async def list_groups(db: AsyncSession = Depends(_get_db)):
    usernames = await _usernames(db)
    groups = (await db.exec(select(Group).order_by(Group.name))).all()
    items = [await _group_view(db, group, usernames) for group in groups]
    return GroupListResponse(items=items, total=len(items))


@groups_router.post("", response_model=GroupResponse)
async def create_group(
    item: CreateGroupRequest, db: AsyncSession = Depends(_get_db)
):
    group = Group(name=_clean_name(item.name), display_name=item.display_name.strip())
    db.add(group)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="A group with that name already exists")
    return await _group_view(db, group, await _usernames(db))


@groups_router.patch("/{group_id}", response_model=GroupResponse)
async def update_group(
    group_id: int, item: UpdateGroupRequest, db: AsyncSession = Depends(_get_db)
):
    group = await load_group(db, group_id)
    if group.system:
        raise _reserved("modified")
    if item.name is not None:
        group.name = _clean_name(item.name)
    if item.display_name is not None:
        group.display_name = item.display_name.strip()
    db.add(group)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="A group with that name already exists")
    return await _group_view(db, group, await _usernames(db))


@groups_router.delete("/{group_id}", response_model=DeleteGroupResponse)
async def delete_group(group_id: int, db: AsyncSession = Depends(_get_db)):
    group = await load_group(db, group_id)
    if group.system:
        raise _reserved("deleted")
    try:
        await db.exec(sql_delete(GroupMember).where(sa_col(GroupMember.group_id) == group_id))
        await db.exec(sql_delete(ResourceAccess).where(sa_col(ResourceAccess.group_id) == group_id))
        await db.exec(
            sql_delete(ResourceOwnerGroup).where(sa_col(ResourceOwnerGroup.group_id) == group_id)
        )
        await db.delete(group)
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=500, detail="Failed to delete group and related records")
    return DeleteGroupResponse(id=group_id)


@groups_router.put("/{group_id}/members", response_model=GroupResponse)
async def set_members(
    group_id: int, item: SetMembersRequest, db: AsyncSession = Depends(_get_db)
):
    group = await load_group(db, group_id)
    if group.system:
        raise _reserved("given members")
    wanted = set(item.usernames)
    if wanted:
        known = set(
            (await db.exec(select(User.username).where(sa_col(User.username).in_(wanted)))).all()
        )
        if unknown := sorted(wanted - known):
            raise HTTPException(status_code=400, detail=f"Unknown username: {unknown[0]}")
    for _ in range(2):
        await db.exec(sql_delete(GroupMember).where(sa_col(GroupMember.group_id) == group_id))
        db.add_all([GroupMember(group_id=group_id, username=u) for u in sorted(wanted)])
        try:
            await db.commit()
            break
        except IntegrityError:
            await db.rollback()
    return await _group_view(db, group, await _usernames(db))
