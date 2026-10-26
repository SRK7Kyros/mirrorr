"""A slot spawns one session that carries the autorun's whole chain.

The chain itself is pure and lives in ``test_fallback_chain``; what is proven
here is the scheduler: one session per slot, its plan is the run's own capture
followed by every rung resolved into a concrete capture, and the row still
answers the old client's two-list shape.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import SQLModel, select
from sqlmodel.ext.asyncio.session import AsyncSession as SQLModelAsyncSession

from mirrorr.api.routers.crud import _serialize_autorun
from mirrorr.services import autorun_scheduler
from mirrorr.services.autorun_scheduler import _tick, slot_key
from mirrorr.startup.config import MirrorrSettings
from mirrorr.storage import crud
from mirrorr.storage.enums import AutorunStatus, SessionStatus
from mirrorr.storage.models import Autorun, Engine, Profile, Resolver, Session


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


async def _seed(maker, *, chain=None, legacy=None, status=AutorunStatus.SCHEDULED, window_open=True, prior=None):
    """One autorun on profile 1 whose chain is *chain* (or *legacy*, if given)."""
    async with maker() as db:
        for row_id in (1, 2, 3):
            db.add(Engine(id=row_id, name=f"engine {row_id}", origin="t", origin_hash="h"))
            db.add(
                Resolver(
                    id=row_id, name=f"resolver {row_id}", description="", origin="t", origin_hash="h"
                )
            )
        for pid in (1, 2, 3):
            db.add(
                Profile(
                    id=pid,
                    name=f"Edge {pid}",
                    default_engine_id=pid,
                    resolver_id=pid,
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
                fallback_chain=chain,
                fallback_profile_ids=(legacy or {}).get("profiles", []),
                fallback_sources=(legacy or {}).get("sources", []),
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


def _plan(session: Session) -> list[tuple]:
    """Each capture of a plan as ``(profile, engine, resolver)`` — the shape a run has."""
    return [
        (entry["profile_id"], entry["engine_id"], entry["resolver_id"])
        for entry in session.capture_plan
    ]


def test_a_slot_carries_a_profile_chain_as_concrete_captures(monkeypatch, tmp_path):
    async def scenario(settings):
        engine, maker = await _fresh_db()
        await _seed(maker, legacy={"profiles": [2, 3]}, prior=SessionStatus.FAILED)

        await _tick(maker, settings)

        spawned = (await _sessions(maker))[-1]
        assert _plan(spawned) == [(1, 1, 1), (2, 2, 2), (3, 3, 3)]
        await engine.dispose()

    _run(scenario, monkeypatch, tmp_path)


def test_a_slot_carries_a_source_rung_on_the_runs_own_engine(monkeypatch, tmp_path):
    async def scenario(settings):
        engine, maker = await _fresh_db()
        await _seed(
            maker,
            chain=[{"profile_id": 2}, {"resolver_id": 3, "resolver_config": {"channel": "ch9"}}],
            prior=SessionStatus.FAILED,
        )

        await _tick(maker, settings)

        spawned = (await _sessions(maker))[-1]
        assert _plan(spawned) == [(1, 1, 1), (2, 2, 2), (None, 1, 3)]
        assert spawned.capture_plan[-1]["resolver_config"] == {"channel": "ch9"}
        await engine.dispose()

    _run(scenario, monkeypatch, tmp_path)


def test_a_slot_spawns_one_session_carrying_the_whole_chain(monkeypatch, tmp_path):
    """The fallbacks are a plan on the session, never sessions of their own."""

    async def scenario(settings):
        engine, maker = await _fresh_db()
        await _seed(maker, chain=[{"profile_id": 2}, {"profile_id": 3}], prior=SessionStatus.FAILED)

        await _tick(maker, settings)

        sessions = await _sessions(maker)
        assert len(sessions) == 2
        spawned = sessions[-1]
        assert spawned.profile_id == 1
        assert (spawned.engine_id, spawned.resolver_id) == (1, 1)
        assert spawned.resolver_config == {"channel": "ch1"}
        assert len(spawned.capture_plan) == 3
        assert spawned.status == SessionStatus.INITIALIZING
        async with maker() as db:
            autorun = await crud.get_by_id(db, Autorun, 1)
            assert autorun.status == AutorunStatus.ACTIVE
        await engine.dispose()

    _run(scenario, monkeypatch, tmp_path)


def test_a_rung_that_no_longer_stands_is_dropped_not_fatal(monkeypatch, tmp_path):
    """A scheduled chain was authorised when it was written; it must still run."""

    async def scenario(settings):
        engine, maker = await _fresh_db()
        await _seed(
            maker,
            chain=[{"profile_id": 2}, {"profile_id": 99}, {"profile_id": 2}],
            prior=SessionStatus.FAILED,
        )

        await _tick(maker, settings)

        spawned = (await _sessions(maker))[-1]
        assert _plan(spawned) == [(1, 1, 1), (2, 2, 2)]
        await engine.dispose()

    _run(scenario, monkeypatch, tmp_path)


def test_a_failed_session_never_spawns_a_second_one(monkeypatch, tmp_path):
    async def scenario(settings):
        engine, maker = await _fresh_db()
        await _seed(maker, chain=[{"profile_id": 2}, {"profile_id": 3}])

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
        await _seed(
            maker, chain=[{"profile_id": 2}], prior=SessionStatus.COMPLETED, status=AutorunStatus.ACTIVE
        )

        await _tick(maker, settings)
        assert len(await _sessions(maker)) == 1
        await engine.dispose()

    _run(scenario, monkeypatch, tmp_path)


def test_a_closed_window_spawns_nothing_more(monkeypatch, tmp_path):
    async def scenario(settings):
        engine, maker = await _fresh_db()
        await _seed(
            maker,
            chain=[{"profile_id": 2}],
            prior=SessionStatus.FAILED,
            status=AutorunStatus.ACTIVE,
            window_open=False,
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
    assert serialized["fallback_chain"] == [{"profile_id": 4}, {"profile_id": 9}]


def test_a_mixed_rung_is_in_the_chain_but_not_in_the_old_two_lists():
    autorun = Autorun(
        user_friendly_name="x",
        snake_case_name="x",
        engine_id=1,
        resolver_id=1,
        fallback_chain=[{"profile_id": 4}, {"profile_id": 5, "engine_id": 2}, {"resolver_id": 3}],
        start_time=_now(),
        end_time=_now(),
    )
    serialized = _serialize_autorun(autorun)
    assert serialized["fallback_chain"] == [
        {"profile_id": 4},
        {"profile_id": 5, "engine_id": 2},
        {"resolver_id": 3},
    ]
    assert serialized["fallback_profile_ids"] == [4]
    assert serialized["fallback_sources"] == [{"resolver_id": 3, "resolver_config": {}}]
