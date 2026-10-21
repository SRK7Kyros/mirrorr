import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import SQLModel, select
from sqlmodel.ext.asyncio.session import AsyncSession as SQLModelAsyncSession

from mirrorr.services import autorun_scheduler
from mirrorr.services.autorun_scheduler import _tick, slot_key
from mirrorr.startup.config import MirrorrSettings
from mirrorr.storage import crud
from mirrorr.storage.enums import AutorunStatus
from mirrorr.storage.models import Autorun, Session


class _Bus:
    def __init__(self) -> None:
        self.events: list = []

    async def emit(self, event) -> None:
        self.events.append(event)


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def _fresh_db():
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    return engine, async_sessionmaker(engine, class_=SQLModelAsyncSession, expire_on_commit=False)


def test_one_slot_starts_exactly_one_session(monkeypatch, tmp_path):
    async def scenario():
        engine, maker = await _fresh_db()
        monkeypatch.setattr(autorun_scheduler, "bus", _Bus())

        async with maker() as db:
            db.add(
                Autorun(
                    id=1,
                    user_friendly_name="F1 Race",
                    snake_case_name="f1-race",
                    engine_id=1,
                    resolver_id=1,
                    status=AutorunStatus.SCHEDULED,
                    start_time=_now() - timedelta(minutes=1),
                    end_time=_now() + timedelta(hours=1),
                    requester_user_token="kyros",
                )
            )
            await db.commit()

        await _tick(maker, MirrorrSettings(base_dir=tmp_path))

        # Re-arm the very same slot — what a lost status flip looks like.
        async with maker() as db:
            autorun = await crud.get_by_id(db, Autorun, 1)
            autorun.status = AutorunStatus.SCHEDULED
            await crud.update(db, Autorun, 1, autorun)

        await _tick(maker, MirrorrSettings(base_dir=tmp_path))

        async with maker() as db:
            sessions = (await db.exec(select(Session))).all()
            assert len(sessions) == 1
            assert sessions[0].idempotency_key == slot_key(await crud.get_by_id(db, Autorun, 1))

        await engine.dispose()

    asyncio.run(scenario())


def test_manual_sessions_carry_no_key_and_do_not_collide():
    async def scenario():
        engine, maker = await _fresh_db()
        async with maker() as db:
            for sid in (1, 2):
                db.add(Session(id=sid, engine_id=1, resolver_id=1, requester_user_token="u"))
            await db.commit()
            sessions = (await db.exec(select(Session))).all()
            assert [s.idempotency_key for s in sessions] == [None, None]
        await engine.dispose()

    asyncio.run(scenario())
