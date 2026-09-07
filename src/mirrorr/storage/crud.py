from collections.abc import Sequence
from dataclasses import dataclass
from typing import TypeVar
from sqlmodel import SQLModel, select
from sqlmodel.ext.asyncio.session import AsyncSession

from mirrorr.storage.models import Profile

T = TypeVar("T", bound=SQLModel)


@dataclass
class PaginatedResult:
    """Result of a paginated query."""
    items: list
    next_cursor: int | None = None
    has_more: bool = False


# --- The "Engine Room" (Internal helpers) ---
async def get_all(db: AsyncSession, model: type[T]) -> list[T]:
    return list((await db.exec(select(model))).all())


async def get_all_paginated(
    db: AsyncSession,
    model: type[T],
    *,
    cursor: int | None = None,
    limit: int = 50,
    order_desc: bool = True,
    options: Sequence = (),
) -> PaginatedResult:
    """Fetch entities with cursor-based pagination.

    Args:
        db: Database session
        model: SQLModel class to query
        cursor: ID of the last item from previous page (None for first page)
        limit: Maximum items per page (default 50)
        order_desc: If True, order by ID descending (newest first)
        options: SQLAlchemy loader options (e.g. selectinload) to eager-load
            relationships so the caller can serialize related names without N+1.

    Returns:
        PaginatedResult with items, next_cursor, and has_more flag
    """
    stmt = select(model)

    if options:
        stmt = stmt.options(*options)

    if cursor is not None:
        if order_desc:
            stmt = stmt.where(model.id < cursor)
        else:
            stmt = stmt.where(model.id > cursor)

    if order_desc:
        stmt = stmt.order_by(model.id.desc())
    else:
        stmt = stmt.order_by(model.id.asc())

    # Fetch one extra to determine if there are more items
    stmt = stmt.limit(limit + 1)

    result = await db.exec(stmt)
    items = list(result.all())

    has_more = len(items) > limit
    if has_more:
        items = items[:limit]

    next_cursor = items[-1].id if has_more and items else None

    return PaginatedResult(items=items, next_cursor=next_cursor, has_more=has_more)


async def count(db: AsyncSession, model: type[T], where_expr=None) -> int:
    """Row count for a model, optionally filtered. Used for `?include_total=1`."""
    from sqlalchemy import func

    stmt = select(func.count()).select_from(model)
    if where_expr is not None:
        stmt = stmt.where(where_expr)
    return int((await db.exec(stmt)).one())


async def get_by_id(db: AsyncSession, model: type[T], id: int, options: Sequence = ()) -> T | None:
    stmt = select(model).where(model.id == id)
    if options:
        stmt = stmt.options(*options)
    result = await db.exec(stmt)
    return result.first()

async def create(db: AsyncSession, obj: T) -> T:
    try:
        db.add(obj)
        await db.commit()
        await db.refresh(obj)
    except Exception as e:
        await db.rollback()
        raise
    return obj

async def update(db: AsyncSession, model: type[T], id: int, data: T) -> T:
    """Update an entity in place.

    Always resolves the persistent instance from the session (identity-map hit
    when the caller already loaded it, so no extra query) and applies the
    incoming object's fields onto it via ``sqlmodel_update``. We deliberately
    do NOT shortcut on ``data.id == id``: that branch re-``add``s a fresh
    object carrying an existing PK, which collides with the already-loaded
    persistent instance in SQLAlchemy's identity map and turns the UPDATE into
    an INSERT (UNIQUE-constraint failure).
    """
    obj = await db.get(model, id)
    if not obj:
        raise ValueError(f"{model.__name__} with id {id} not found")

    try:
        obj.sqlmodel_update(data)
        db.add(obj)
        await db.commit()
        await db.refresh(obj)
    except Exception as e:
        await db.rollback()
        raise
    return obj

async def delete(db: AsyncSession, model: type[T], id: int) -> None:
    obj = await db.get(model, id)
    if not obj:
        raise ValueError(f"{model.__name__} with id {id} not found")
    try:
        await db.delete(obj)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise
