from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import SQLModel, select
from sqlmodel.ext.asyncio.session import AsyncSession as SQLModelAsyncSession

from mirrorr.api.dependencies import AuthState
from mirrorr.api.routers.crud import _load_fallback_chain, _serialize_autorun
from mirrorr.services import autorun_scheduler
from mirrorr.services.autorun_scheduler import _tick, fallback_chain, slot_key
from mirrorr.startup.config import MirrorrSettings
from mirrorr.storage import crud
from mirrorr.storage.enums import AutorunStatus, SessionStatus
from mirrorr.storage.models import Autorun, Profile, Session, User


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


async def _seed(maker, fallbacks: list[int], *, status=AutorunStatus.SCHEDULED, window_open=True, prior=None):
    """One autorun on profile 1 with *fallbacks*; *prior* seeds an earlier session."""
    async with maker() as db:
        for pid, resolver in ((1, 1), (2, 2), (3, 3)):
            db.add(
                Profile(
                    id=pid,
                    name=f"Edge {pid}",
                    default_engine_id=pid,
                    resolver_id=resolver,
                    resolver_config={"channel": f"ch{pid}"},
                    retry_mode="none",
                    retry_config={},
                )
            )
        end = _now() + (timedelta(hours=1) if window_open else timedelta(minutes=-1))
        db.add(
            Autorun(
                id=1,
                user_friendly_name="F1 Race",
                snake_case_name="f1-race",
                profile_id=1,
                engine_id=1,
                resolver_id=1,
                resolver_config={"channel": "ch1"},
                fallback_profile_ids=fallbacks,
                status=status,
                start_time=_now() - timedelta(minutes=30),
                end_time=end,
                requester_user_token="kyros",
            )
        )
        if prior is not None:
            db.add(
                Session(
                    id=1,
                    profile_id=1,
                    autorun_id=1,
                    engine_id=1,
                    resolver_id=1,
                    requester_user_token="kyros",
                    status=prior,
                    idempotency_key="autorun:1:slot:x",
                )
            )
        await db.commit()


async def _sessions(maker) -> list[Session]:
    async with maker() as db:
        return list((await db.exec(select(Session).order_by(Session.id))).all())


def _run(scenario, monkeypatch, tmp_path):
    monkeypatch.setattr(autorun_scheduler, "bus", _Bus())
    asyncio.run(scenario(MirrorrSettings(base_dir=tmp_path)))


def test_chain_is_the_own_profile_then_each_fallback_once():
    autorun = Autorun(
        user_friendly_name="x",
        snake_case_name="x",
        profile_id=1,
        engine_id=1,
        resolver_id=1,
        fallback_profile_ids=[2, 1, 3, 2],
        start_time=_now(),
        end_time=_now(),
    )
    assert fallback_chain(autorun) == [1, 2, 3]


def test_an_autorun_without_a_profile_falls_back_from_nothing():
    autorun = Autorun(
        user_friendly_name="x",
        snake_case_name="x",
        engine_id=1,
        resolver_id=1,
        fallback_profile_ids=[2],
        start_time=_now(),
        end_time=_now(),
    )
    assert fallback_chain(autorun) == [None, 2]


def test_a_slot_spawns_one_session_carrying_the_whole_chain(monkeypatch, tmp_path):
    """The fallbacks are a plan on the session, never sessions of their own."""

    async def scenario(settings):
        engine, maker = await _fresh_db()
        await _seed(maker, [2, 3], prior=SessionStatus.FAILED)

        await _tick(maker, settings)

        sessions = await _sessions(maker)
        assert len(sessions) == 2
        spawned = sessions[-1]
        assert spawned.profile_id == 1
        assert (spawned.engine_id, spawned.resolver_id) == (1, 1)
        assert spawned.resolver_config == {"channel": "ch1"}
        assert spawned.stint_plan == [1, 2, 3]
        assert spawned.status == SessionStatus.INITIALIZING
        async with maker() as db:
            autorun = await crud.get_by_id(db, Autorun, 1)
            assert autorun.status == AutorunStatus.ACTIVE
        await engine.dispose()

    _run(scenario, monkeypatch, tmp_path)


def test_a_failed_session_never_spawns_a_second_one(monkeypatch, tmp_path):
    async def scenario(settings):
        engine, maker = await _fresh_db()
        await _seed(maker, [2, 3])

        await _tick(maker, settings)
        async with maker() as db:
            autorun = await crud.get_by_id(db, Autorun, 1)
            spawned = (await db.exec(select(Session).order_by(Session.id.desc()))).first()
            spawned.status = SessionStatus.FAILED
            await db.commit()

        for _ in range(3):
            await _tick(maker, settings)

        sessions = await _sessions(maker)
        assert [(s.profile_id, s.idempotency_key) for s in sessions] == [
            (1, slot_key(autorun))
        ]
        await engine.dispose()

    _run(scenario, monkeypatch, tmp_path)


def test_completed_session_does_not_start_another(monkeypatch, tmp_path):
    async def scenario(settings):
        engine, maker = await _fresh_db()
        await _seed(maker, [2], prior=SessionStatus.COMPLETED, status=AutorunStatus.ACTIVE)

        await _tick(maker, settings)
        assert len(await _sessions(maker)) == 1
        await engine.dispose()

    _run(scenario, monkeypatch, tmp_path)


def test_a_closed_window_spawns_nothing_more(monkeypatch, tmp_path):
    async def scenario(settings):
        engine, maker = await _fresh_db()
        await _seed(
            maker, [2], prior=SessionStatus.FAILED,
            status=AutorunStatus.ACTIVE, window_open=False,
        )

        await _tick(maker, settings)
        assert len(await _sessions(maker)) == 1
        await engine.dispose()

    _run(scenario, monkeypatch, tmp_path)


def test_fallback_names_travel_with_the_response():
    autorun = Autorun(
        user_friendly_name="x",
        snake_case_name="x",
        engine_id=1,
        resolver_id=1,
        fallback_profile_ids=[4, 9],
        start_time=_now(),
        end_time=_now(),
    )
    serialized = _serialize_autorun(autorun, {4: "GB edge"})
    assert serialized["fallback_profile_ids"] == [4, 9]
    assert serialized["fallback_profile_names"] == ["GB edge", ""]


def test_fallback_chain_accepts_a_visible_profile_and_rejects_the_rest():
    async def scenario():
        engine, maker = await _fresh_db()
        async with maker() as db:
            db.add(User(username="kyros", password_hash="x"))
            db.add(User(username="other", password_hash="x"))
            db.add(Profile(id=2, name="Shared", default_engine_id=1, resolver_id=1, requester_user_token="kyros"))
            db.add(Profile(id=3, name="Private", default_engine_id=1, resolver_id=1, requester_user_token="other"))
            await db.commit()
            auth = AuthState(user=User(username="kyros", password_hash="x"))

            assert await _load_fallback_chain(db, [2], auth, 1) == [2]
            with pytest.raises(HTTPException) as own:
                await _load_fallback_chain(db, [2], auth, 2)
            assert own.value.status_code == 422
            with pytest.raises(HTTPException) as twice:
                await _load_fallback_chain(db, [2, 2], auth, 1)
            assert twice.value.status_code == 422
            with pytest.raises(HTTPException) as private:
                await _load_fallback_chain(db, [3], auth, 1)
            assert private.value.status_code == 403
            with pytest.raises(HTTPException) as missing:
                await _load_fallback_chain(db, [99], auth, 1)
            assert missing.value.status_code == 400
        await engine.dispose()

    asyncio.run(scenario())

