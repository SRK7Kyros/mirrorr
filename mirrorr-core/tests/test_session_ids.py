from __future__ import annotations

import asyncio

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession as SQLModelAsyncSession

from mirrorr.storage import crud
from mirrorr.storage.models import Session


def test_deleting_a_session_frees_its_id_for_reuse():
    async def scenario() -> None:
        engine = create_async_engine("sqlite+aiosqlite://")
        async with engine.begin() as conn:
            await conn.run_sync(SQLModel.metadata.create_all)
        maker = async_sessionmaker(engine, class_=SQLModelAsyncSession, expire_on_commit=False)

        async with maker() as db:
            for sid in (1, 2, 3):
                db.add(Session(id=sid, engine_id=1, resolver_id=1, requester_user_token="u"))
            await db.commit()
            assert await crud.next_free_id(db, Session) == 4

            await crud.delete(db, Session, 2)
            assert await crud.next_free_id(db, Session) == 2

        await engine.dispose()

    asyncio.run(scenario())
