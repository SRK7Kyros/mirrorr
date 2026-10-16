"""Capability gates on the session-logs router (``VIEW``) and the export routes (``EXPORT``).

The frozen mapping is exclusive: ``GET /sessions/{id}/logs`` needs ``VIEW`` and
the profile/autorun export routes need ``EXPORT``. A grant of one must never
open the other, so each case asserts the ungranted principal's status **and**
body — a gate that silently allowed everyone would fail these tests.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from unittest.mock import AsyncMock

from fastapi import Request
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession as SQLModelAsyncSession

from mirrorr.api.api import API
from mirrorr.api.dependencies import AuthState, _get_db_session, get_auth
from mirrorr.di import container
from mirrorr.plugin_api.interfaces import Capabilities
from mirrorr.startup.config import MirrorrSettings
from mirrorr.storage.enums import Capability, ResourceType, SessionStatus, UserRole
from mirrorr.storage.models import (
    Autorun,
    Engine,
    Profile,
    Resolver,
    ResourceAccess,
    Session,
    User,
)

NOW = datetime.now(timezone.utc).replace(tzinfo=None)


class Harness:
    def __init__(self, client: AsyncClient, maker: async_sessionmaker, holder: dict) -> None:
        self.client = client
        self.maker = maker
        self.holder = holder

    def as_user(self, username: str, admin: bool = False) -> None:
        self.holder["auth"] = AuthState(
            client=None,
            user=User(id=1, username=username, role=UserRole.ADMIN if admin else UserRole.USER),
            is_admin=admin,
        )


@asynccontextmanager
async def _harness(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'test.db'}")
    maker = async_sessionmaker(engine, class_=SQLModelAsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    container.configure(
        settings=MirrorrSettings(base_dir=tmp_path, content_dir=tmp_path / "content"),
        session_factory=maker,
        event_bus=AsyncMock(),
    )
    holder: dict = {"auth": AuthState(client=None, user=None)}

    async def _db():
        async with maker() as session:
            yield session

    def _auth(request: Request):
        current = holder["auth"]
        request.state.is_admin = current.is_admin
        return current

    API.dependency_overrides[_get_db_session] = _db
    API.dependency_overrides[get_auth] = _auth
    try:
        async with AsyncClient(transport=ASGITransport(app=API), base_url="http://t") as client:
            yield Harness(client, maker, holder)
    finally:
        API.dependency_overrides.clear()
        container.reset()
        await engine.dispose()


async def _seed(maker) -> dict[str, int]:
    async with maker() as db:
        db.add_all([User(username="alice"), User(username="bob")])
        engine = Engine(name="yt_dlp_piped", origin="local", origin_hash="h1", capabilities=Capabilities())
        resolver = Resolver(name="static", description="", origin="local", origin_hash="h2")
        db.add_all([engine, resolver])
        await db.commit()
        eid, rid = engine.id, resolver.id

        profile = Profile(
            name="Alice News", default_engine_id=eid, resolver_id=rid, requester_user_token="alice"
        )
        db.add(profile)
        await db.commit()

        autorun = Autorun(
            user_friendly_name="Alice Evening",
            snake_case_name="alice_evening",
            profile_id=profile.id,
            engine_id=eid,
            resolver_id=rid,
            start_time=NOW,
            end_time=NOW,
            requester_user_token="alice",
        )
        session = Session(
            autorun_id=autorun.id,
            profile_id=profile.id,
            engine_id=eid,
            resolver_id=rid,
            status=SessionStatus.COMPLETED,
            requester_user_token="alice",
        )
        db.add_all([autorun, session])
        await db.commit()
        return {"profile": profile.id, "autorun": autorun.id, "session": session.id}


async def _grant(maker, resource_type: ResourceType, resource_id: int, capability: Capability, username: str = "bob") -> None:
    async with maker() as db:
        db.add(ResourceAccess(
            resource_type=resource_type, resource_id=resource_id,
            username=username, capability=capability,
        ))
        await db.commit()


_LOGS = "/sessions/{id}/logs"
_PROFILE_EXPORT = "/import-export/profiles/{id}/export"
_AUTORUN_EXPORT = "/import-export/autoruns/{id}/export"
_EXPORT_DENIED = "Not authorized to export this resource"
_LOGS_DENIED = "Not your session"


def test_view_grant_reads_logs_but_cannot_export(tmp_path):
    """VIEW alone opens logs (200) and never export (403 on both kinds)."""
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            await _grant(h.maker, ResourceType.SESSION, ids["session"], Capability.VIEW)
            await _grant(h.maker, ResourceType.PROFILE, ids["profile"], Capability.VIEW)
            await _grant(h.maker, ResourceType.AUTORUN, ids["autorun"], Capability.VIEW)

            h.as_user("bob")
            logs = await h.client.get(_LOGS.format(id=ids["session"]))
            assert logs.status_code == 200, logs.text
            assert logs.json()["session_id"] == ids["session"]

            profile = await h.client.get(_PROFILE_EXPORT.format(id=ids["profile"]))
            assert profile.status_code == 403, profile.text
            assert profile.json()["detail"] == _EXPORT_DENIED

            autorun = await h.client.get(_AUTORUN_EXPORT.format(id=ids["autorun"]))
            assert autorun.status_code == 403, autorun.text
            assert autorun.json()["detail"] == _EXPORT_DENIED

    asyncio.run(scenario())


def test_export_grant_exports_but_cannot_read_logs(tmp_path):
    """EXPORT alone opens export (200) and never logs (403)."""
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            await _grant(h.maker, ResourceType.PROFILE, ids["profile"], Capability.EXPORT)
            await _grant(h.maker, ResourceType.AUTORUN, ids["autorun"], Capability.EXPORT)

            h.as_user("bob")
            profile = await h.client.get(_PROFILE_EXPORT.format(id=ids["profile"]))
            assert profile.status_code == 200, profile.text
            assert profile.json()["profiles"][0]["name"] == "Alice News"

            autorun = await h.client.get(_AUTORUN_EXPORT.format(id=ids["autorun"]))
            assert autorun.status_code == 200, autorun.text
            assert autorun.json()["autoruns"][0]["user_friendly_name"] == "Alice Evening"

            logs = await h.client.get(_LOGS.format(id=ids["session"]))
            assert logs.status_code == 403, logs.text
            assert logs.json()["detail"] == _LOGS_DENIED

    asyncio.run(scenario())


def test_view_and_export_grant_both_succeed(tmp_path):
    """VIEW + EXPORT grants open both surfaces."""
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            await _grant(h.maker, ResourceType.SESSION, ids["session"], Capability.VIEW)
            await _grant(h.maker, ResourceType.PROFILE, ids["profile"], Capability.EXPORT)
            await _grant(h.maker, ResourceType.AUTORUN, ids["autorun"], Capability.EXPORT)

            h.as_user("bob")
            assert (await h.client.get(_LOGS.format(id=ids["session"]))).status_code == 200
            assert (await h.client.get(_PROFILE_EXPORT.format(id=ids["profile"]))).status_code == 200
            assert (await h.client.get(_AUTORUN_EXPORT.format(id=ids["autorun"]))).status_code == 200

    asyncio.run(scenario())


def test_no_grant_denies_both(tmp_path):
    """No grant → logs 403 and export 403 (the gates are not no-ops)."""
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)

            h.as_user("bob")
            logs = await h.client.get(_LOGS.format(id=ids["session"]))
            assert logs.status_code == 403, logs.text
            assert logs.json()["detail"] == _LOGS_DENIED
            assert (await h.client.get(_PROFILE_EXPORT.format(id=ids["profile"]))).status_code == 403
            assert (await h.client.get(_AUTORUN_EXPORT.format(id=ids["autorun"]))).status_code == 403

    asyncio.run(scenario())


def test_owner_and_admin_read_and_export(tmp_path):
    """Owner and admin pass both surfaces with no grants present."""
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)

            h.as_user("alice")
            assert (await h.client.get(_LOGS.format(id=ids["session"]))).status_code == 200
            assert (await h.client.get(_PROFILE_EXPORT.format(id=ids["profile"]))).status_code == 200
            assert (await h.client.get(_AUTORUN_EXPORT.format(id=ids["autorun"]))).status_code == 200

            h.as_user("root", admin=True)
            assert (await h.client.get(_LOGS.format(id=ids["session"]))).status_code == 200
            assert (await h.client.get(_PROFILE_EXPORT.format(id=ids["profile"]))).status_code == 200
            assert (await h.client.get(_AUTORUN_EXPORT.format(id=ids["autorun"]))).status_code == 200

    asyncio.run(scenario())


def test_unauthenticated_is_401(tmp_path):
    """An anonymous caller is rejected before any capability lookup."""
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)

            h.holder["auth"] = AuthState(client=None, user=None)
            assert (await h.client.get(_LOGS.format(id=ids["session"]))).status_code == 401

    asyncio.run(scenario())
