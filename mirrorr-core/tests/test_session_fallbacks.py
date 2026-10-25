"""A manual session may name fallbacks, the same way an autorun does.

The session's own capture comes first — its profile when one was named,
otherwise the engine+resolver the request supplied — and each fallback after
it: a profile run whole, or a source (resolver + config) on the run's own
engine. One session runs the whole chain.
"""
from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession as SQLModelAsyncSession

from mirrorr.api.dependencies import AuthState
from mirrorr.api.routers.crud import create_session
from mirrorr.api.schemas import CreateSessionRequest
from mirrorr.storage.models import Engine, Profile, Resolver, User


async def _fresh_db():
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    return engine, async_sessionmaker(engine, class_=SQLModelAsyncSession, expire_on_commit=False)


async def _seed(maker) -> None:
    async with maker() as db:
        db.add(User(username="kyros", password_hash="x"))
        db.add(User(username="other", password_hash="x"))
        for pid in (1, 2):
            db.add(Engine(id=pid, name=f"engine {pid}", origin=f"e{pid}", origin_hash=f"h{pid}"))
            db.add(
                Resolver(
                    id=pid,
                    name=f"resolver {pid}",
                    description="",
                    origin=f"r{pid}",
                    origin_hash=f"h{pid}",
                )
            )
        db.add(Profile(id=1, name="Own", default_engine_id=1, resolver_id=1, requester_user_token="kyros"))
        db.add(Profile(id=2, name="Shared", default_engine_id=2, resolver_id=2, requester_user_token="kyros"))
        db.add(Profile(id=3, name="Private", default_engine_id=2, resolver_id=2, requester_user_token="other"))
        await db.commit()


def _auth() -> AuthState:
    return AuthState(user=User(username="kyros", password_hash="x"))


async def _create(db, **body):
    return await create_session(CreateSessionRequest(**body), db, _auth())


def test_a_custom_session_tries_its_own_capture_then_each_fallback():
    async def scenario():
        engine, maker = await _fresh_db()
        await _seed(maker)
        async with maker() as db:
            out = await _create(db, engine_id=1, resolver_id=1, fallback_profile_ids=[2])
            assert out["capture_plan"] == [None, 2]
            assert out["profile_id"] is None
        await engine.dispose()

    asyncio.run(scenario())


def test_a_profile_session_keeps_its_profile_first():
    async def scenario():
        engine, maker = await _fresh_db()
        await _seed(maker)
        async with maker() as db:
            out = await _create(db, profile_id=1, fallback_profile_ids=[2])
            assert out["capture_plan"] == [1, 2]
        async with maker() as db:
            alone = await _create(db, profile_id=1)
            assert alone["capture_plan"] == [1]
        await engine.dispose()

    asyncio.run(scenario())


def test_a_custom_session_without_fallbacks_plans_nothing():
    async def scenario():
        engine, maker = await _fresh_db()
        await _seed(maker)
        async with maker() as db:
            out = await _create(db, engine_id=1, resolver_id=1)
            assert out["capture_plan"] == []
        await engine.dispose()

    asyncio.run(scenario())


def test_a_session_refuses_its_own_profile_and_a_profile_it_cannot_see():
    async def scenario():
        engine, maker = await _fresh_db()
        await _seed(maker)
        async with maker() as db:
            with pytest.raises(HTTPException) as own:
                await _create(db, profile_id=1, fallback_profile_ids=[1])
            assert own.value.status_code == 422
            assert "session's own profile" in own.value.detail["detail"]
            with pytest.raises(HTTPException) as twice:
                await _create(db, engine_id=1, resolver_id=1, fallback_profile_ids=[2, 2])
            assert twice.value.status_code == 422
            with pytest.raises(HTTPException) as private:
                await _create(db, engine_id=1, resolver_id=1, fallback_profile_ids=[3])
            assert private.value.status_code == 403
        await engine.dispose()

    asyncio.run(scenario())


def test_a_custom_session_falls_back_to_sources_after_its_own():
    async def scenario():
        engine, maker = await _fresh_db()
        await _seed(maker)
        async with maker() as db:
            out = await _create(
                db,
                engine_id=1,
                resolver_id=1,
                resolver_config={"channel": "one"},
                fallback_sources=[
                    {"resolver_id": 2, "resolver_config": {"channel": "two"}},
                    {"resolver_id": 2},
                ],
            )
            assert out["capture_plan"] == [
                None,
                {"resolver_id": 2, "resolver_config": {"channel": "two"}},
                {"resolver_id": 2, "resolver_config": {}},
            ]
            assert out["resolver_id"] == 1
        await engine.dispose()

    asyncio.run(scenario())


def test_a_source_chain_keeps_the_runs_own_engine():
    async def scenario():
        engine, maker = await _fresh_db()
        await _seed(maker)
        async with maker() as db:
            out = await _create(
                db,
                engine_id=2,
                resolver_id=1,
                fallback_sources=[{"resolver_id": 2, "resolver_config": {"x": 1}}],
            )
            assert out["engine_id"] == 2
            assert out["capture_plan"] == [
                None,
                {"resolver_id": 2, "resolver_config": {"x": 1}},
            ]
        await engine.dispose()

    asyncio.run(scenario())


def test_a_session_refuses_its_own_source_twice_and_an_unknown_resolver():
    async def scenario():
        engine, maker = await _fresh_db()
        await _seed(maker)
        async with maker() as db:
            with pytest.raises(HTTPException) as own:
                await _create(
                    db, engine_id=1, resolver_id=1, fallback_sources=[{"resolver_id": 1}]
                )
            assert own.value.status_code == 422
            assert own.value.detail["rule"] == "fallback-source-is-primary"
            with pytest.raises(HTTPException) as twice:
                await _create(
                    db,
                    engine_id=1,
                    resolver_id=1,
                    fallback_sources=[{"resolver_id": 2}, {"resolver_id": 2}],
                )
            assert twice.value.status_code == 422
            assert twice.value.detail["rule"] == "fallback-source-duplicate"
            with pytest.raises(HTTPException) as unknown:
                await _create(db, engine_id=1, resolver_id=1, fallback_sources=[{"resolver_id": 9}])
            assert unknown.value.status_code == 400
        await engine.dispose()

    asyncio.run(scenario())


def test_a_source_is_its_config_too_so_the_same_resolver_twice_is_allowed():
    async def scenario():
        engine, maker = await _fresh_db()
        await _seed(maker)
        async with maker() as db:
            out = await _create(
                db,
                engine_id=1,
                resolver_id=1,
                fallback_sources=[
                    {"resolver_id": 2, "resolver_config": {"ref": "a"}},
                    {"resolver_id": 2, "resolver_config": {"ref": "b"}},
                ],
            )
            assert out["capture_plan"] == [
                None,
                {"resolver_id": 2, "resolver_config": {"ref": "a"}},
                {"resolver_id": 2, "resolver_config": {"ref": "b"}},
            ]
        await engine.dispose()

    asyncio.run(scenario())
