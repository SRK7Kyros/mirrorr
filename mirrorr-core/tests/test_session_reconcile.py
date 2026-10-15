from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession as SQLModelAsyncSession

from mirrorr.di import container
from mirrorr.services.session_lifecycle import fail_orphaned_sessions
from mirrorr.startup.config import MirrorrSettings
from mirrorr.storage import crud
from mirrorr.storage.models import Session
from mirrorr.storage.enums import SessionStatus


def test_only_mid_flight_sessions_are_failed(tmp_path):
    async def scenario():
        engine = create_async_engine("sqlite+aiosqlite://")
        async with engine.begin() as conn:
            await conn.run_sync(SQLModel.metadata.create_all)
        maker = async_sessionmaker(engine, class_=SQLModelAsyncSession, expire_on_commit=False)

        async with maker() as db:
            for sid, status in ((1, SessionStatus.ACTIVE), (2, SessionStatus.COMPLETED), (3, SessionStatus.RECORDING)):
                db.add(
                    Session(id=sid, engine_id=1, resolver_id=1, status=status, requester_user_token="u")
                )
            await db.commit()

        container.configure(
            settings=MirrorrSettings(base_dir=tmp_path),
            session_factory=maker,
            event_bus=AsyncMock(),
        )
        try:
            orphaned = await fail_orphaned_sessions(
                MirrorrSettings(base_dir=tmp_path), nc=AsyncMock()
            )
        finally:
            container.reset()

        assert orphaned == [1, 3]

        async with maker() as db:
            live = await crud.get_by_id(db, Session, 1)
            done = await crud.get_by_id(db, Session, 3)
            spent = await crud.get_by_id(db, Session, 2)
        assert live.status == SessionStatus.FAILED
        assert live.ended_at is not None
        assert done.status == SessionStatus.FAILED
        assert spent.status == SessionStatus.COMPLETED

        await engine.dispose()

    asyncio.run(scenario())


def test_pre_gate_sessions_are_orphaned_too(tmp_path):
    """initializing/stream_pending rows have no supervisor after a restart either."""

    async def scenario():
        engine = create_async_engine("sqlite+aiosqlite://")
        async with engine.begin() as conn:
            await conn.run_sync(SQLModel.metadata.create_all)
        maker = async_sessionmaker(engine, class_=SQLModelAsyncSession, expire_on_commit=False)

        async with maker() as db:
            for sid, status in ((1, SessionStatus.INITIALIZING), (2, SessionStatus.STREAM_PENDING)):
                db.add(
                    Session(id=sid, engine_id=1, resolver_id=1, status=status, requester_user_token="u")
                )
            await db.commit()

        container.configure(
            settings=MirrorrSettings(base_dir=tmp_path),
            session_factory=maker,
            event_bus=AsyncMock(),
        )
        try:
            orphaned = await fail_orphaned_sessions(
                MirrorrSettings(base_dir=tmp_path), nc=AsyncMock()
            )
        finally:
            container.reset()

        assert orphaned == [1, 2]

        async with maker() as db:
            for sid in (1, 2):
                assert (await crud.get_by_id(db, Session, sid)).status == SessionStatus.FAILED

        await engine.dispose()

    asyncio.run(scenario())
