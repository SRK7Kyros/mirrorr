"""The frozen /shares/ surface.

One sharing router gated by ``Capability.SHARE`` (owner | admin | SHARE
holder), replace-set POSTs, idempotent DELETE, and the frozen ``AccessView``
shape. The three old ``/admin/resources/{t}/{id}/access*`` routes are gone.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import Request
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import SQLModel, select
from sqlmodel.ext.asyncio.session import AsyncSession as SQLModelAsyncSession
from unittest.mock import AsyncMock

from mirrorr.api.api import API
from mirrorr.api.dependencies import AuthState, _get_db_session, get_auth
from mirrorr.di import container
from mirrorr.plugin_api.interfaces import Capabilities
from mirrorr.storage.enums import Capability, ResourceType, SessionStatus, UserRole
from mirrorr.storage.models import (
    Engine,
    Profile,
    Resolver,
    ResolverSource,
    ResourceAccess,
    Session,
    User,
)
from mirrorr.startup.config import MirrorrSettings

NOW = datetime.now(timezone.utc).replace(tzinfo=None)


class Harness:
    def __init__(self, client: AsyncClient, maker: async_sessionmaker, holder: dict) -> None:
        self.client = client
        self.maker = maker
        self.holder = holder

    def as_user(self, username: str | None, admin: bool = False) -> None:
        if username is None:
            self.holder["auth"] = AuthState(client=None, user=None)
            return
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
        db.add_all([
            User(username="admin", role=UserRole.ADMIN),
            User(username="alice"),
            User(username="bob"),
            User(username="carol"),
        ])
        engine = Engine(name="yt_dlp_piped", origin="local", origin_hash="h1", capabilities=Capabilities())
        resolver = Resolver(name="static", description="", origin="local", origin_hash="h2")
        db.add_all([engine, resolver])
        await db.commit()
        eid, rid = engine.id, resolver.id

        alice_profile = Profile(
            name="Alice News", default_engine_id=eid, resolver_id=rid, requester_user_token="alice"
        )
        ghost_profile = Profile(
            name="Ghost Feed", default_engine_id=eid, resolver_id=rid, requester_user_token="ghost"
        )
        source = ResolverSource(name="Alice Source", resolver_id=rid, requester_user_token="alice")
        db.add_all([alice_profile, ghost_profile, source])
        await db.commit()
        session = Session(
            profile_id=alice_profile.id,
            engine_id=eid,
            resolver_id=rid,
            status=SessionStatus.COMPLETED,
            requester_user_token="alice",
        )
        db.add(session)
        await db.commit()
        return {
            "engine": eid,
            "resolver": rid,
            "profile": alice_profile.id,
            "ghost_profile": ghost_profile.id,
            "source": source.id,
            "session": session.id,
        }


async def _grant_rows(maker, username: str | None = None) -> list:
    async with maker() as db:
        stmt = select(ResourceAccess)
        if username is not None:
            stmt = stmt.where(ResourceAccess.username == username)
        return list((await db.exec(stmt)).all())


_VIEW_OPERATE = {"username": "bob", "capabilities": ["VIEW", "OPERATE"]}


def test_replace_set_idempotent_and_exact(tmp_path):
    """Replace-set: a second POST overwrites, never appends — exact capabilities."""
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            sid = ids["session"]
            h.as_user("admin", admin=True)

            first = await h.client.post(f"/shares/session/{sid}", json=_VIEW_OPERATE)
            assert first.status_code == 200, first.text
            assert first.json() == {
                "resource_type": "session", "id": sid, "owner": "alice", "owner_missing": False,
                "grants": [{"username": "bob", "capabilities": ["VIEW", "OPERATE"]}],
                "owner_groups": [], "group_grants": [],
            }
            assert len(await _grant_rows(h.maker, username="bob")) == 2

            replaced = await h.client.post(f"/shares/session/{sid}", json={"username": "bob", "capabilities": ["VIEW"]})
            assert replaced.status_code == 200, replaced.text
            assert replaced.json()["grants"] == [{"username": "bob", "capabilities": ["VIEW"]}]
            rows = await _grant_rows(h.maker, username="bob")
            assert len(rows) == 1 and rows[0].capability is Capability.VIEW

            again = await h.client.post(f"/shares/session/{sid}", json={"username": "bob", "capabilities": ["VIEW"]})
            assert again.status_code == 200 and again.json() == replaced.json()
            assert len(await _grant_rows(h.maker, username="bob")) == 1

            cleared = await h.client.post(f"/shares/session/{sid}", json={"username": "bob", "capabilities": []})
            assert cleared.status_code == 200 and cleared.json()["grants"] == []
            assert await _grant_rows(h.maker, username="bob") == []

    asyncio.run(scenario())


def test_nonempty_grant_list_always_includes_view(tmp_path):
    """A non-empty POST list always carries VIEW (stored and returned)."""
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            sid = ids["session"]
            h.as_user("admin", admin=True)

            resp = await h.client.post(f"/shares/session/{sid}", json={"username": "bob", "capabilities": ["OPERATE"]})
            assert resp.status_code == 200, resp.text
            assert resp.json()["grants"] == [{"username": "bob", "capabilities": ["VIEW", "OPERATE"]}]
            rows = await _grant_rows(h.maker, username="bob")
            assert sorted(r.capability.value for r in rows) == ["OPERATE", "VIEW"]

    asyncio.run(scenario())


def test_empty_grant_list_clears_every_row(tmp_path):
    """A POST with an empty list clears the user's grants entirely."""
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            sid = ids["session"]
            h.as_user("admin", admin=True)

            await h.client.post(f"/shares/session/{sid}", json={"username": "bob", "capabilities": ["OPERATE", "SHARE"]})
            assert len(await _grant_rows(h.maker, username="bob")) == 3

            cleared = await h.client.post(f"/shares/session/{sid}", json={"username": "bob", "capabilities": []})
            assert cleared.status_code == 200 and cleared.json()["grants"] == []
            assert await _grant_rows(h.maker, username="bob") == []

    asyncio.run(scenario())


def test_capabilities_sorted_and_owner_excluded(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            sid = ids["session"]
            h.as_user("admin", admin=True)

            resp = await h.client.post(
                f"/shares/session/{sid}",
                json={"username": "bob", "capabilities": ["EXPORT", "VIEW", "SHARE", "VIEW"]},
            )
            assert resp.status_code == 200, resp.text
            assert resp.json()["grants"] == [{"username": "bob", "capabilities": ["VIEW", "SHARE", "EXPORT"]}]

            add_owner = await h.client.post(f"/shares/session/{sid}", json={"username": "alice", "capabilities": ["VIEW"]})
            assert add_owner.status_code == 200
            assert [g["username"] for g in add_owner.json()["grants"]] == ["bob"]

    asyncio.run(scenario())


def test_owner_and_admin_pass_without_a_grant(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            sid = ids["session"]

            h.as_user("alice")
            assert (await h.client.get(f"/shares/session/{sid}")).status_code == 200
            assert (await h.client.post(f"/shares/session/{sid}", json={"username": "bob", "capabilities": ["VIEW"]})).status_code == 200
            assert (await h.client.delete(f"/shares/session/{sid}/bob")).status_code == 200

            h.as_user("admin", admin=True)
            assert (await h.client.get(f"/shares/session/{sid}")).status_code == 200

    asyncio.run(scenario())


def test_share_less_and_view_only_are_denied_then_share_flips(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            sid = ids["session"]
            h.as_user("admin", admin=True)
            await h.client.post(f"/shares/session/{sid}", json={"username": "bob", "capabilities": ["VIEW"]})

            h.as_user("bob")
            for response in await asyncio.gather(
                h.client.get(f"/shares/session/{sid}"),
                h.client.post(f"/shares/session/{sid}", json={"username": "carol", "capabilities": ["VIEW"]}),
                h.client.delete(f"/shares/session/{sid}/bob"),
            ):
                assert response.status_code == 403, response.text
                assert response.json()["detail"] == "Missing capability: SHARE"
            assert await _grant_rows(h.maker, username="carol") == []

            h.as_user("admin", admin=True)
            await h.client.post(f"/shares/session/{sid}", json={"username": "bob", "capabilities": ["VIEW", "SHARE"]})

            h.as_user("bob")
            assert (await h.client.get(f"/shares/session/{sid}")).status_code == 200
            assert (await h.client.post(f"/shares/session/{sid}", json={"username": "carol", "capabilities": ["VIEW"]})).status_code == 200
            assert (await h.client.delete(f"/shares/session/{sid}/carol")).status_code == 200

    asyncio.run(scenario())


def test_unauthenticated_is_401(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            sid = ids["session"]
            h.as_user(None)
            for response in await asyncio.gather(
                h.client.get(f"/shares/session/{sid}"),
                h.client.post(f"/shares/session/{sid}", json={"username": "bob", "capabilities": ["VIEW"]}),
                h.client.delete(f"/shares/session/{sid}/bob"),
            ):
                assert response.status_code == 401, response.text

    asyncio.run(scenario())


def test_malformed_input_is_clean_and_creates_nothing(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            sid = ids["session"]
            h.as_user("admin", admin=True)

            assert (await h.client.post(f"/shares/session/{sid}", json={"username": "bob", "capabilities": ["FLY"]})).status_code == 400
            assert (await h.client.post(f"/shares/bogus/{sid}", json={"username": "bob", "capabilities": ["VIEW"]})).status_code == 404
            assert (await h.client.post("/shares/session/999", json={"username": "bob", "capabilities": ["VIEW"]})).status_code == 404
            assert (await h.client.post("/shares/user/1", json={"username": "bob", "capabilities": ["VIEW"]})).status_code == 400
            assert (await h.client.post("/shares/engine/1", json={"username": "bob", "capabilities": ["VIEW"]})).status_code == 400
            assert (await h.client.post("/shares/resolver/1", json={"username": "bob", "capabilities": ["VIEW"]})).status_code == 400
            assert (await h.client.get("/shares/resolver/1")).status_code == 400
            assert (await h.client.post(f"/shares/session/{sid}", json={"username": "nobody", "capabilities": ["VIEW"]})).status_code == 400
            assert await _grant_rows(h.maker) == []

    asyncio.run(scenario())


def test_stale_grant_user_and_missing_owner_do_not_crash(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            sid = ids["session"]
            async with h.maker() as db:
                db.add(ResourceAccess(resource_type=ResourceType.SESSION, resource_id=sid, username="ghost", capability=Capability.VIEW))
                await db.commit()

            h.as_user("admin", admin=True)
            body = (await h.client.get(f"/shares/session/{sid}")).json()
            assert body["grants"] == [{"username": "ghost", "capabilities": ["VIEW"]}]
            assert body["owner_missing"] is False

            ghost = (await h.client.get(f"/shares/profile/{ids['ghost_profile']}")).json()
            assert ghost["owner"] == "ghost" and ghost["owner_missing"] is True

    asyncio.run(scenario())


def test_source_view_carries_no_owner_token(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            source_id = ids["source"]
            h.as_user("admin", admin=True)
            await h.client.post(f"/shares/source/{source_id}", json={"username": "bob", "capabilities": ["VIEW", "SHARE"]})

            h.as_user("bob")
            view = await h.client.get(f"/shares/source/{source_id}")
            assert view.status_code == 200, view.text
            assert set(view.json().keys()) == {
                "resource_type", "id", "owner", "owner_missing", "grants",
                "owner_groups", "group_grants",
            }
            assert "requester_user_token" not in view.text

            detail = await h.client.get(f"/sources/{source_id}")
            assert detail.status_code == 200, detail.text
            assert "requester_user_token" not in detail.json()

    asyncio.run(scenario())


def test_admin_routes_kept_and_old_access_routes_removed(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            sid = ids["session"]

            h.as_user("bob")
            assert (await h.client.get("/admin/resources")).status_code == 403
            assert (await h.client.put(f"/admin/resources/session/{sid}/owner", json={"username": "bob"})).status_code == 403

            removed = await asyncio.gather(
                h.client.get(f"/admin/resources/session/{sid}/access"),
                h.client.post(f"/admin/resources/session/{sid}/access", json={"username": "bob"}),
                h.client.delete(f"/admin/resources/session/{sid}/access/bob"),
            )
            assert [r.status_code for r in removed] == [404, 404, 404], [r.text for r in removed]

            h.as_user("admin", admin=True)
            assert (await h.client.get("/admin/resources")).status_code == 200
            moved = await h.client.put(f"/admin/resources/session/{sid}/owner", json={"username": "carol"})
            assert moved.status_code == 200 and moved.json()["owner"] == "carol"

    asyncio.run(scenario())


def test_admin_viewer_count_counts_distinct_users_not_rows(tmp_path):
    """A user holding several capabilities is one viewer, not one row each."""
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            sid = ids["session"]
            h.as_user("admin", admin=True)
            await h.client.post(f"/shares/session/{sid}", json={"username": "bob", "capabilities": ["VIEW", "OPERATE", "SHARE"]})
            await h.client.post(f"/shares/session/{sid}", json={"username": "carol", "capabilities": ["VIEW"]})

            listed = (await h.client.get("/admin/resources", params={"resource_type": "session"})).json()
            assert listed["items"][0]["viewer_count"] == 2

    asyncio.run(scenario())


def test_concurrent_grants_leave_one_row_per_capability(tmp_path):
    """Two racing replace-set POSTs must not 500 and must settle on one row each."""
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            sid = ids["session"]
            h.as_user("admin", admin=True)

            import mirrorr.api.routers.auth as auth_routes

            original = auth_routes._known_username
            barrier = asyncio.Barrier(2)

            async def synced_known(db, username):
                await original(db, username)
                await barrier.wait()

            auth_routes._known_username = synced_known
            try:
                body = {"username": "bob", "capabilities": ["VIEW", "OPERATE"]}
                first, second = await asyncio.wait_for(
                    asyncio.gather(
                        h.client.post(f"/shares/session/{sid}", json=body),
                        h.client.post(f"/shares/session/{sid}", json=body),
                    ),
                    timeout=10,
                )
            finally:
                auth_routes._known_username = original

            assert first.status_code == 200, first.text
            assert second.status_code == 200, second.text
            rows = await _grant_rows(h.maker, username="bob")
            assert sorted(r.capability.value for r in rows) == ["OPERATE", "VIEW"]

    asyncio.run(scenario())
