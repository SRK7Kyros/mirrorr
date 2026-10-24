from __future__ import annotations

import asyncio
import time
from unittest.mock import AsyncMock

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession as SQLModelAsyncSession

from mirrorr.di import container
from mirrorr.event_bus.handlers import handlers
from mirrorr.services.session_lifecycle import update_session
from mirrorr.startup.config import MirrorrSettings
from mirrorr.storage import crud
from mirrorr.storage.enums import SessionStatus
from mirrorr.storage.models import Session


class _FakeProcess:
    def __init__(self, alive: bool) -> None:
        self._alive = alive

    def is_alive(self) -> bool:
        return self._alive


def _engine_and_maker():
    engine = create_async_engine("sqlite+aiosqlite://")
    maker = async_sessionmaker(engine, class_=SQLModelAsyncSession, expire_on_commit=False)
    return engine, maker


async def _seed(maker, *rows: Session) -> None:
    async with maker() as db:
        for row in rows:
            db.add(row)
        await db.commit()


def _session(session_id: int, status: SessionStatus) -> Session:
    return Session(
        id=session_id,
        engine_id=1,
        resolver_id=1,
        status=status,
        requester_user_token="u",
    )


def test_active_session_gets_started_at_on_a_non_status_update(tmp_path):
    """A row is born ACTIVE, so its first update has no status diff to hang off."""

    async def scenario():
        engine, maker = _engine_and_maker()
        async with engine.begin() as conn:
            await conn.run_sync(SQLModel.metadata.create_all)
        await _seed(maker, _session(1, SessionStatus.ACTIVE))

        settings = MirrorrSettings(base_dir=tmp_path)
        container.configure(settings=settings, db_factory=maker, event_bus=AsyncMock())
        try:
            diff = await update_session(
                settings, 1, session_urls=[{"label": "HLS", "url": "x"}], nc=AsyncMock()
            )
        finally:
            container.reset()

        assert "started_at" in diff
        async with maker() as db:
            session = await crud.get_by_id(db, Session, 1)
            assert session.started_at is not None
            assert session.status == SessionStatus.ACTIVE

        await engine.dispose()

    asyncio.run(scenario())


def test_watchdog_fails_only_sessions_abandoned_past_the_grace(tmp_path):
    async def scenario():
        engine, maker = _engine_and_maker()
        async with engine.begin() as conn:
            await conn.run_sync(SQLModel.metadata.create_all)
        await _seed(
            maker,
            _session(1, SessionStatus.ACTIVE),
            _session(2, SessionStatus.COMPLETED),
        )

        container.configure(
            settings=MirrorrSettings(base_dir=tmp_path),
            db_factory=maker,
            event_bus=AsyncMock(),
        )
        handlers._supervisors.clear()
        try:
            # First sighting only starts the grace clock.
            assert await handlers._sweep_dead_supervisors({}) == []

            stale = {1: time.monotonic() - handlers._WATCHDOG_GRACE - 1}
            assert await handlers._sweep_dead_supervisors(stale) == [1]

            # A live supervisor protects its session and clears the clock.
            handlers._supervisors[1] = (_FakeProcess(True), None)
            protected = {1: time.monotonic() - handlers._WATCHDOG_GRACE - 1}
            assert await handlers._sweep_dead_supervisors(protected) == []
            assert protected == {}

            # Terminal sessions are never considered.
            assert await handlers._sweep_dead_supervisors({2: 0.0}) == []
        finally:
            handlers._supervisors.clear()
            container.reset()

        await engine.dispose()

    asyncio.run(scenario())
