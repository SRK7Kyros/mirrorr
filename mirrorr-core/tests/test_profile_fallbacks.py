"""A profile carries its own chain of fallback sources.

A run bound to a profile inherits that chain the same way it inherits the
profile's engine, resolver and retry policy — without the caller having to
repeat it — and saving a run as a profile keeps the sources it actually tried.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import SQLModel, select
from sqlmodel.ext.asyncio.session import AsyncSession as SQLModelAsyncSession

from mirrorr.api.dependencies import AuthState
from mirrorr.api.routers.crud import (
    create_autorun,
    create_profile,
    create_session,
    save_session_as_profile,
    update_autorun,
    update_profile,
)
from mirrorr.api.schemas import (
    CreateAutorunRequest,
    CreateProfileRequest,
    CreateSessionRequest,
    SaveProfileRequest,
    UpdateAutorunRequest,
    UpdateProfileRequest,
)
from mirrorr.storage.enums import UserRole
from mirrorr.storage.models import Engine, Profile, Resolver, User


def _auth() -> AuthState:
    return AuthState(
        user=User(id=1, username="kyros", role=UserRole.USER), is_admin=False
    )


async def _fresh_db():
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    return engine, async_sessionmaker(engine, class_=SQLModelAsyncSession, expire_on_commit=False)


async def _seed(maker) -> None:
    async with maker() as db:
        db.add(User(id=1, username="kyros", password_hash="x", role=UserRole.USER))
        for pid in (1, 2, 3):
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
        await db.commit()


def _profile(**body) -> CreateProfileRequest:
    return CreateProfileRequest(**{"name": "F1 UK", "default_engine_id": 1, "resolver_id": 1, **body})


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def test_a_profile_keeps_its_chain_in_the_order_it_was_given():
    async def scenario():
        engine, maker = await _fresh_db()
        await _seed(maker)
        async with maker() as db:
            out = await create_profile(
                _profile(
                    resolver_config={"channel": "60"},
                    fallback_sources=[
                        {"resolver_id": 2, "resolver_config": {"channel": "577"}},
                        {"resolver_id": 3},
                    ],
                ),
                db,
                _auth(),
            )
            assert out["fallback_sources"] == [
                {"resolver_id": 2, "resolver_config": {"channel": "577"}},
                {"resolver_id": 3, "resolver_config": {}},
            ]
        await engine.dispose()

    asyncio.run(scenario())


def test_a_profiles_chain_refuses_its_own_source_and_a_repeat():
    async def scenario():
        engine, maker = await _fresh_db()
        await _seed(maker)
        async with maker() as db:
            with pytest.raises(HTTPException) as own:
                await create_profile(
                    _profile(
                        resolver_config={"channel": "60"},
                        fallback_sources=[
                            {"resolver_id": 1, "resolver_config": {"channel": "60"}}
                        ],
                    ),
                    db,
                    _auth(),
                )
            assert own.value.status_code == 422
            assert own.value.detail["rule"] == "fallback-source-is-primary"
            assert "profile's own source" in own.value.detail["detail"]
            with pytest.raises(HTTPException) as twice:
                await create_profile(
                    _profile(
                        fallback_sources=[{"resolver_id": 2}, {"resolver_id": 2}],
                    ),
                    db,
                    _auth(),
                )
            assert twice.value.status_code == 422
            assert twice.value.detail["rule"] == "fallback-source-duplicate"
        await engine.dispose()

    asyncio.run(scenario())


def test_the_same_resolver_on_another_channel_is_not_a_repeat():
    async def scenario():
        engine, maker = await _fresh_db()
        await _seed(maker)
        async with maker() as db:
            out = await create_profile(
                _profile(
                    resolver_config={"channel": "60"},
                    fallback_sources=[
                        {"resolver_id": 1, "resolver_config": {"channel": "577"}},
                    ],
                ),
                db,
                _auth(),
            )
            assert out["fallback_sources"] == [
                {"resolver_id": 1, "resolver_config": {"channel": "577"}}
            ]
        await engine.dispose()

    asyncio.run(scenario())


def test_updating_a_profile_replaces_its_chain():
    async def scenario():
        engine, maker = await _fresh_db()
        await _seed(maker)
        async with maker() as db:
            created = await create_profile(
                _profile(fallback_sources=[{"resolver_id": 2}]), db, _auth()
            )
            out = await update_profile(
                created["id"], UpdateProfileRequest(fallback_sources=[]), db, _auth()
            )
            assert out["fallback_sources"] == []
        await engine.dispose()

    asyncio.run(scenario())


def test_an_untouched_update_keeps_the_chain():
    async def scenario():
        engine, maker = await _fresh_db()
        await _seed(maker)
        async with maker() as db:
            created = await create_profile(
                _profile(fallback_sources=[{"resolver_id": 2}]), db, _auth()
            )
            out = await update_profile(
                created["id"], UpdateProfileRequest(name="F1 UK 2"), db, _auth()
            )
            assert out["fallback_sources"] == [{"resolver_id": 2, "resolver_config": {}}]
        await engine.dispose()

    asyncio.run(scenario())


def test_a_session_started_from_the_profile_inherits_its_chain():
    async def scenario():
        engine, maker = await _fresh_db()
        await _seed(maker)
        async with maker() as db:
            profile = await create_profile(
                _profile(fallback_sources=[{"resolver_id": 2}]), db, _auth()
            )
            session = await create_session(CreateSessionRequest(profile_id=profile["id"]), db, _auth())
            assert session["capture_plan"] == [
                profile["id"],
                {"resolver_id": 2, "resolver_config": {}},
            ]
        await engine.dispose()

    asyncio.run(scenario())


def test_a_session_may_name_its_own_chain_instead():
    async def scenario():
        engine, maker = await _fresh_db()
        await _seed(maker)
        async with maker() as db:
            profile = await create_profile(
                _profile(fallback_sources=[{"resolver_id": 2}]), db, _auth()
            )
            session = await create_session(
                CreateSessionRequest(
                    profile_id=profile["id"], fallback_sources=[{"resolver_id": 3}]
                ),
                db,
                _auth(),
            )
            assert session["capture_plan"] == [
                profile["id"],
                {"resolver_id": 3, "resolver_config": {}},
            ]
        await engine.dispose()

    asyncio.run(scenario())


def test_inheriting_drops_a_rung_repeating_the_runs_own_source():
    async def scenario():
        engine, maker = await _fresh_db()
        await _seed(maker)
        async with maker() as db:
            profile = await create_profile(
                _profile(
                    fallback_sources=[
                        {"resolver_id": 1, "resolver_config": {"channel": "60"}},
                        {"resolver_id": 2},
                    ],
                ),
                db,
                _auth(),
            )
            session = await create_session(
                CreateSessionRequest(
                    profile_id=profile["id"], resolver_config={"channel": "60"}
                ),
                db,
                _auth(),
            )
            assert session["capture_plan"] == [
                profile["id"],
                {"resolver_id": 2, "resolver_config": {}},
            ]
        await engine.dispose()

    asyncio.run(scenario())


def test_an_autorun_bound_to_the_profile_inherits_its_chain():
    async def scenario():
        engine, maker = await _fresh_db()
        await _seed(maker)
        async with maker() as db:
            profile = await create_profile(
                _profile(fallback_sources=[{"resolver_id": 2}]), db, _auth()
            )
            autorun = await create_autorun(
                CreateAutorunRequest(
                    user_friendly_name="Race",
                    snake_case_name="race",
                    profile_id=profile["id"],
                    start_time=_now(),
                    end_time=_now() + timedelta(hours=2),
                ),
                db,
                _auth(),
            )
            assert autorun["fallback_sources"] == [
                {"resolver_id": 2, "resolver_config": {}}
            ]
        await engine.dispose()

    asyncio.run(scenario())


def test_an_update_that_names_no_chain_inherits_the_profiles():
    async def scenario():
        engine, maker = await _fresh_db()
        await _seed(maker)
        async with maker() as db:
            profile = await create_profile(
                _profile(fallback_sources=[{"resolver_id": 2}]), db, _auth()
            )
            autorun = await create_autorun(
                CreateAutorunRequest(
                    user_friendly_name="Race",
                    snake_case_name="race",
                    engine_id=1,
                    resolver_id=1,
                    start_time=_now(),
                    end_time=_now() + timedelta(hours=2),
                ),
                db,
                _auth(),
            )
            assert autorun["fallback_sources"] == []
            out = await update_autorun(
                autorun["id"], UpdateAutorunRequest(profile_id=profile["id"]), db, _auth()
            )
            assert out["fallback_sources"] == [{"resolver_id": 2, "resolver_config": {}}]
        await engine.dispose()

    asyncio.run(scenario())


def test_an_update_may_clear_the_chain_while_it_sets_the_profile():
    """A declared empty chain is the chain, not a request to inherit one.

    Setting a profile and clearing the chain in one save is how the console's
    bulk action gives a whole selection one profile with no fallbacks; if the
    empty list fell back to the profile's chain the operator could never say
    "this source and nothing else".
    """
    async def scenario():
        engine, maker = await _fresh_db()
        await _seed(maker)
        async with maker() as db:
            profile = await create_profile(
                _profile(fallback_sources=[{"resolver_id": 2}]), db, _auth()
            )
            autorun = await create_autorun(
                CreateAutorunRequest(
                    user_friendly_name="Race",
                    snake_case_name="race",
                    engine_id=1,
                    resolver_id=1,
                    fallback_sources=[{"resolver_id": 3}],
                    start_time=_now(),
                    end_time=_now() + timedelta(hours=2),
                ),
                db,
                _auth(),
            )
            assert autorun["fallback_sources"] == [{"resolver_id": 3, "resolver_config": {}}]
            out = await update_autorun(
                autorun["id"],
                UpdateAutorunRequest(profile_id=profile["id"], fallback_sources=[]),
                db,
                _auth(),
            )
            assert out["fallback_sources"] == []
            assert out["profile_id"] == profile["id"]
        await engine.dispose()

    asyncio.run(scenario())


def test_a_created_run_may_clear_the_chain_of_the_profile_it_names():
    async def scenario():
        engine, maker = await _fresh_db()
        await _seed(maker)
        async with maker() as db:
            profile = await create_profile(
                _profile(fallback_sources=[{"resolver_id": 2}]), db, _auth()
            )
            autorun = await create_autorun(
                CreateAutorunRequest(
                    user_friendly_name="Race",
                    snake_case_name="race",
                    profile_id=profile["id"],
                    fallback_sources=[],
                    start_time=_now(),
                    end_time=_now() + timedelta(hours=2),
                ),
                db,
                _auth(),
            )
            assert autorun["fallback_sources"] == []
        await engine.dispose()

    asyncio.run(scenario())


def test_saving_a_session_as_a_profile_keeps_the_sources_it_tried():
    async def scenario():
        engine, maker = await _fresh_db()
        await _seed(maker)
        async with maker() as db:
            session = await create_session(
                CreateSessionRequest(
                    engine_id=1,
                    resolver_id=1,
                    resolver_config={"channel": "60"},
                    fallback_sources=[
                        {"resolver_id": 2, "resolver_config": {"channel": "577"}}
                    ],
                ),
                db,
                _auth(),
            )
            saved = await save_session_as_profile(
                session["id"], SaveProfileRequest(name="From a session"), db, _auth()
            )
            assert saved.fallback_sources == [
                {"resolver_id": 2, "resolver_config": {"channel": "577"}}
            ]
        await engine.dispose()

    asyncio.run(scenario())


def test_a_profile_with_no_chain_stores_nothing():
    async def scenario():
        engine, maker = await _fresh_db()
        await _seed(maker)
        async with maker() as db:
            out = await create_profile(_profile(), db, _auth())
            assert out["fallback_sources"] == []
            stored = await db.get(Profile, out["id"])
            assert stored is not None and stored.fallback_sources == []
        await engine.dispose()

    asyncio.run(scenario())


def test_a_profile_that_predates_the_chain_reads_an_empty_list(tmp_path):
    """A DB written before the column existed must not answer NULL.

    The column's default is Python-side, so `ALTER TABLE ... ADD COLUMN` left
    every existing row NULL — and both the response model and a PUT's merge
    base require a list, which turned `GET /profiles/` into a 500.
    """

    async def scenario():
        from sqlalchemy import text

        from mirrorr.startup.config import MirrorrSettings
        from mirrorr.startup.ensure_db import ensure_db
        from mirrorr.storage.database import create_db_engine

        from mirrorr.api.routers.crud import _PROFILE_OPTIONS, _serialize_profile
        from mirrorr.api.schemas import ProfileResponse

        settings = MirrorrSettings(base_dir=tmp_path)
        engine, maker = create_db_engine(settings)
        await ensure_db(engine)
        await _seed(maker)
        async with maker() as db:
            await create_profile(_profile(name="Old"), db, _auth())
        async with engine.begin() as conn:
            await conn.execute(text("ALTER TABLE profiles DROP COLUMN fallback_sources"))

        await ensure_db(engine)

        async with maker() as db:
            row = (await db.exec(select(Profile).options(*_PROFILE_OPTIONS))).one()
            assert row.fallback_sources == []
            response = ProfileResponse.model_validate(_serialize_profile(row))
            assert response.fallback_sources == []
        await engine.dispose()

    asyncio.run(scenario())
