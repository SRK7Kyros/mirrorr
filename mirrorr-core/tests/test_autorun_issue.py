"""A schedule outlives the profile it was built from — and says so.

Deleting a profile used to take its owner's autoruns with it, silently: a
recording nobody was told about simply did not happen. The schedule now
survives, detached and flagged, and the scheduler leaves it alone until
somebody saves it again.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import SQLModel, select
from sqlmodel.ext.asyncio.session import AsyncSession as SQLModelAsyncSession

from mirrorr.api.dependencies import AuthState
from mirrorr.api.routers import crud as crud_router
from mirrorr.api.routers.crud import _cascade_delete_profile, update_autorun
from mirrorr.api.schemas import UpdateAutorunRequest
from mirrorr.services import autorun_scheduler
from mirrorr.services.autorun_scheduler import _tick
from mirrorr.startup.config import MirrorrSettings
from mirrorr.storage.enums import AutorunStatus, UserRole
from mirrorr.storage.models import Autorun, Engine, Profile, Resolver, Session, User


class _Bus:
    def __init__(self) -> None:
        self.events: list = []

    async def emit(self, event) -> None:
        self.events.append(event)


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def _fresh_db(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'test.db'}")
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    return engine, async_sessionmaker(engine, class_=SQLModelAsyncSession, expire_on_commit=False)


async def _seed(maker, *, owners: tuple[str, ...] = ("kyros",), issue: str | None = None) -> dict[str, int]:
    async with maker() as db:
        db.add(User(username="kyros", role=UserRole.USER))
        db.add(Engine(id=1, name="yt_dlp_piped", description="", origin="local", origin_hash="h1"))
        db.add(Resolver(id=1, name="static", description="", origin="local", origin_hash="h2"))
        db.add(Profile(id=1, name="F1 Edge", default_engine_id=1, resolver_id=1, requester_user_token="kyros"))
        await db.commit()
        ids = []
        for index, owner in enumerate(owners, start=1):
            autorun = Autorun(
                id=index,
                user_friendly_name=f"Race {index}",
                snake_case_name=f"race-{index}",
                profile_id=1,
                engine_id=1,
                resolver_id=1,
                resolver_config={"channel": "ch1"},
                status=AutorunStatus.SCHEDULED,
                start_time=_now() - timedelta(minutes=30),
                end_time=_now() + timedelta(hours=1),
                requester_user_token=owner,
                issue=issue,
            )
            db.add(autorun)
            ids.append(index)
        await db.commit()
        return {"profile": 1, "autoruns": ids}


async def _autorun(maker, autorun_id: int) -> Autorun | None:
    async with maker() as db:
        return await db.get(Autorun, autorun_id)


async def _sessions(maker) -> list[Session]:
    async with maker() as db:
        return list((await db.exec(select(Session))).all())


def test_deleting_a_profile_flags_every_schedule_built_from_it(tmp_path, monkeypatch):
    """Both the owner's schedule and another user's survive, and both are flagged."""
    bus = _Bus()
    monkeypatch.setattr(crud_router, "bus", bus)

    async def scenario():
        engine, maker = await _fresh_db(tmp_path)
        try:
            ids = await _seed(maker, owners=("kyros", "bob"))
            async with maker() as db:
                counts = await _cascade_delete_profile(db, ids["profile"])
                await db.commit()
            assert counts["flagged"] == 2
            assert "autoruns" not in counts
            for autorun_id in ids["autoruns"]:
                row = await _autorun(maker, autorun_id)
                assert row is not None, "a schedule must never vanish with its profile"
                assert row.profile_id is None
                assert row.issue == "profile-deleted"
                assert row.engine_id == 1 and row.resolver_config == {"channel": "ch1"}
            assert len([e for e in bus.events if e.subject.startswith("autorun.updated")]) == 2
        finally:
            await engine.dispose()

    asyncio.run(scenario())


def test_a_flagged_schedule_does_not_run_until_it_is_saved(tmp_path, monkeypatch):
    """The warning is honest: the scheduler skips it, and clearing the issue revives it."""
    monkeypatch.setattr(autorun_scheduler, "bus", _Bus())

    async def scenario():
        engine, maker = await _fresh_db(tmp_path)
        try:
            ids = await _seed(maker, issue="profile-deleted")
            settings = MirrorrSettings(base_dir=tmp_path)
            await _tick(maker, settings)
            assert await _sessions(maker) == []

            async with maker() as db:
                row = await db.get(Autorun, ids["autoruns"][0])
                row.issue = None
                row.profile_id = None
                db.add(row)
                await db.commit()

            await _tick(maker, settings)
            sessions = await _sessions(maker)
            assert len(sessions) == 1
            assert sessions[0].autorun_id == ids["autoruns"][0]
        finally:
            await engine.dispose()

    asyncio.run(scenario())


def test_saving_a_flagged_schedule_clears_the_issue(tmp_path):
    """Re-saving is the acknowledgement — the bulk 'set profile' path relies on it."""
    async def scenario():
        engine, maker = await _fresh_db(tmp_path)
        try:
            ids = await _seed(maker, issue="profile-deleted")
            auth = AuthState(client=None, user=User(id=1, username="kyros", role=UserRole.USER), is_admin=False)
            async with maker() as db:
                await update_autorun(
                    ids["autoruns"][0],
                    UpdateAutorunRequest(user_friendly_name="Race renamed"),
                    db=db,
                    auth=auth,
                )
            row = await _autorun(maker, ids["autoruns"][0])
            assert row.issue is None
            assert row.user_friendly_name == "Race renamed"
        finally:
            await engine.dispose()

    asyncio.run(scenario())
