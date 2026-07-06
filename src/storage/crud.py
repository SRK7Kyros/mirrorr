from collections.abc import Sequence
from typing import TypeVar
from sqlmodel import SQLModel, select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.storage.models import Profile

T = TypeVar("T", bound=SQLModel)
# --- The "Engine Room" (Internal helpers) ---
async def get_all(db: AsyncSession, model: type[T]) -> Sequence[T]:
    return (await db.exec(select(model))).all()

async def get_by_id(db: AsyncSession, model: type[T], id: int) -> T | None:
    return await db.get(model, id)

async def create(db: AsyncSession, obj: T) -> T:
    try:
        db.add(obj)
        await db.commit()
        await db.refresh(obj)
    except Exception as e:
        await db.rollback()
        raise e
    return obj

async def update(db: AsyncSession, model: type[T], id: int, data: T) -> T:
    obj = await db.get(model, id)
    if not obj:
        raise ValueError(f"{model.__name__} with id {id} not found")

    try:
        data.id = id
        obj.sqlmodel_update(data)
        db.add(obj)
        await db.commit()
        await db.refresh(obj)
    except Exception as e:
        await db.rollback()
        raise e
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

async def get_profile_by_name(session: AsyncSession, name: str) -> Profile | None:
    statement = select(Profile).where(Profile.name == name)
    result = await session.exec(statement)
    return result.first()
