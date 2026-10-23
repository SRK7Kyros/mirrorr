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


async def _seed(maker, fallbacks: list[int], *, status=AutorunStatus.ACTIVE, window_open=True):
    """One autorun on profile 1 with *fallbacks*, plus a FAILED first attempt."""
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
        db.add(
            Session(
                id=1,
                profile_id=1,
                autorun_id=1,
                engine_id=1,
                resolver_id=1,
                requester_user_token="kyros",
                status=SessionStatus.FAILED,
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


def test_failed_attempt_starts_the_next_profile_and_copies_its_capture(monkeypatch, tmp_path):
    async def scenario(settings):
        engine, maker = await _fresh_db()
        await _seed(maker, [2, 3])

        await _tick(maker, settings)

        sessions = await _sessions(maker)
        assert len(sessions) == 2
        spawned = sessions[-1]
        assert spawned.profile_id == 2
        assert (spawned.engine_id, spawned.resolver_id) == (2, 2)
        assert spawned.resolver_config == {"channel": "ch2"}
        assert spawned.status == SessionStatus.INITIALIZING
        async with maker() as db:
            autorun = await crud.get_by_id(db, Autorun, 1)
            assert autorun.status == AutorunStatus.ACTIVE
        await engine.dispose()

    _run(scenario, monkeypatch, tmp_path)


def test_each_rung_starts_at_most_one_session(monkeypatch, tmp_path):
    async def scenario(settings):
        engine, maker = await _fresh_db()
        await _seed(maker, [2, 3])
        for _ in range(3):
            await _tick(maker, settings)
        sessions = await _sessions(maker)
        async with maker() as db:
            expected = slot_key(await crud.get_by_id(db, Autorun, 1), "fb1")
        assert [(s.profile_id, s.idempotency_key) for s in sessions] == [(1, "autorun:1:slot:x"), (2, expected)]
        await engine.dispose()

    _run(scenario, monkeypatch, tmp_path)


def test_chain_walks_to_the_last_rung_then_stops(monkeypatch, tmp_path):
    async def scenario(settings):
        engine, maker = await _fresh_db()
        await _seed(maker, [2, 3])
        async with maker() as db:
            for sid, pid in ((2, 2),):
                db.add(
                    Session(
                        id=sid,
                        profile_id=pid,
                        autorun_id=1,
                        engine_id=pid,
                        resolver_id=pid,
                        requester_user_token="kyros",
                        status=SessionStatus.FAILED,
                    )
                )
            await db.commit()

        await _tick(maker, settings)
        sessions = await _sessions(maker)
        assert [s.profile_id for s in sessions] == [1, 2, 3]

        async with maker() as db:
            third = await crud.get_by_id(db, Session, 3)
            third.status = SessionStatus.FAILED
            await db.commit()

        await _tick(maker, settings)
        sessions = await _sessions(maker)
        assert [s.profile_id for s in sessions] == [1, 2, 3]
        await engine.dispose()

    _run(scenario, monkeypatch, tmp_path)


def test_completed_attempt_does_not_fall_back(monkeypatch, tmp_path):
    async def scenario(settings):
        engine, maker = await _fresh_db()
        await _seed(maker, [2])
        async with maker() as db:
            first = await crud.get_by_id(db, Session, 1)
            first.status = SessionStatus.COMPLETED
            await db.commit()

        await _tick(maker, settings)
        assert len(await _sessions(maker)) == 1
        await engine.dispose()

    _run(scenario, monkeypatch, tmp_path)


def test_closed_window_does_not_fall_back(monkeypatch, tmp_path):
    async def scenario(settings):
        engine, maker = await _fresh_db()
        await _seed(maker, [2], window_open=False)

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


def test_a_manual_session_of_another_profile_does_not_advance(monkeypatch, tmp_path):
    async def scenario(settings):
        engine, maker = await _fresh_db()
        await _seed(maker, [2])
        async with maker() as db:
            db.add(
                Session(
                    id=2,
                    profile_id=7,
                    autorun_id=1,
                    engine_id=1,
                    resolver_id=1,
                    requester_user_token="kyros",
                    status=SessionStatus.FAILED,
                )
            )
            await db.commit()

        await _tick(maker, settings)
        assert len(await _sessions(maker)) == 2
        await engine.dispose()

    _run(scenario, monkeypatch, tmp_path)
