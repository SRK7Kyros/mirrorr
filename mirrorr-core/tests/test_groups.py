"""The groups surface: the reserved ``everyone`` row, admin CRUD + membership,
and the group principal in capability grants and additive ownership — plus the
user-owner twin of an owner group."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import Request
from httpx import ASGITransport, AsyncClient
from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import SQLModel, select
from sqlmodel.ext.asyncio.session import AsyncSession as SQLModelAsyncSession
from unittest.mock import AsyncMock, patch

from mirrorr.api.api import API
from mirrorr.api.dependencies import AuthState, _get_db_session, get_auth
from mirrorr.di import container
from mirrorr.plugin_api.interfaces import Capabilities
from mirrorr.services.permissions import has_capability
from mirrorr.storage.database import create_db_engine
from mirrorr.storage.enums import Capability, SessionStatus, UserRole
from mirrorr.storage.models import (
    Engine,
    GroupMember,
    Profile,
    Resolver,
    ResourceAccess,
    ResourceOwnerGroup,
    ResourceOwnerUser,
    Session,
    User,
)
from mirrorr.startup.config import MirrorrSettings
from mirrorr.startup.ensure_db import ensure_db

ALL = list(Capability)


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
    await ensure_db(engine)
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
        profile = Profile(
            name="Alice News", default_engine_id=eid, resolver_id=rid, requester_user_token="alice"
        )
        db.add(profile)
        await db.commit()
        session = Session(
            profile_id=profile.id,
            engine_id=eid,
            resolver_id=rid,
            status=SessionStatus.COMPLETED,
            requester_user_token="alice",
        )
        db.add(session)
        await db.commit()
        return {"engine": eid, "resolver": rid, "profile": profile.id, "session": session.id}


async def _rows(maker, model, **where) -> list:
    async with maker() as db:
        stmt = select(model)
        for column, value in where.items():
            stmt = stmt.where(getattr(model, column) == value)
        return list((await db.exec(stmt)).all())


async def _everyone_id(client) -> int:
    listing = (await client.get("/groups")).json()
    return next(g["id"] for g in listing["items"] if g["name"] == "everyone")


async def _create(h, name: str, display_name: str = "") -> dict:
    response = await h.client.post("/groups", json={"name": name, "display_name": display_name})
    assert response.status_code == 200, response.text
    return response.json()


async def _caps(maker, username: str, obj_id: int) -> dict[Capability, bool]:
    async with maker() as db:
        obj = await db.get(Session, obj_id)
        auth = AuthState(client=None, user=User(id=1, username=username, role=UserRole.USER))
        return {cap: await has_capability(db, auth, obj, cap) for cap in ALL}


# ── The reserved group ──────────────────────────────────────────────────────

def test_everyone_is_seeded_implicit_and_reserved(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            await _seed(h.maker)

            h.as_user("bob")
            assert (await h.client.get("/groups")).status_code == 403

            h.as_user("admin", admin=True)
            listing = (await h.client.get("/groups")).json()
            assert listing["total"] == 1
            everyone = listing["items"][0]
            assert everyone["name"] == "everyone" and everyone["system"] is True
            assert everyone["display_name"] == "Everyone"
            assert everyone["member_count"] == 4
            assert everyone["members"] == ["admin", "alice", "bob", "carol"]

            gid = everyone["id"]
            assert (await h.client.put(f"/groups/{gid}/members", json={"usernames": ["bob"]})).status_code == 400
            assert (await h.client.patch(f"/groups/{gid}", json={"name": "x"})).status_code == 400
            assert (await h.client.patch(f"/groups/{gid}", json={"display_name": "X"})).status_code == 400
            assert (await h.client.delete(f"/groups/{gid}")).status_code == 400

            reserved = await h.client.post("/groups", json={"name": "everyone"})
            assert reserved.status_code == 409 and "reserved" in reserved.json()["detail"]

    asyncio.run(scenario())


# ── CRUD ────────────────────────────────────────────────────────────────────

def test_create_rename_delete_and_validation(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            await _seed(h.maker)
            h.as_user("admin", admin=True)

            created = await h.client.post("/groups", json={"name": "  f1-team  ", "display_name": " F1 team "})
            assert created.status_code == 200, created.text
            body = created.json()
            assert body["name"] == "f1-team" and body["display_name"] == "F1 team"
            assert body["system"] is False and body["member_count"] == 0 and body["members"] == []

            assert (await h.client.post("/groups", json={"name": "f1-team"})).status_code == 409
            assert (await h.client.post("/groups", json={"name": "   "})).status_code == 400

            renamed = await h.client.patch(f"/groups/{body['id']}", json={"name": "f1", "display_name": "F1"})
            assert renamed.status_code == 200, renamed.text
            assert renamed.json()["name"] == "f1" and renamed.json()["display_name"] == "F1"

            assert (await h.client.patch("/groups/999", json={"name": "x"})).status_code == 404
            assert (await h.client.delete("/groups/999")).status_code == 404

            deleted = await h.client.delete(f"/groups/{body['id']}")
            assert deleted.json() == {"status": "deleted", "id": body["id"]}
            assert (await h.client.get("/groups")).json()["total"] == 1

    asyncio.run(scenario())


def test_members_replace_set_and_idempotent(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            await _seed(h.maker)
            h.as_user("admin", admin=True)
            gid = (await _create(h, "f1-team"))["id"]

            first = await h.client.put(f"/groups/{gid}/members", json={"usernames": ["bob", "carol"]})
            assert first.status_code == 200, first.text
            assert first.json()["members"] == ["bob", "carol"] and first.json()["member_count"] == 2
            again = await h.client.put(f"/groups/{gid}/members", json={"usernames": ["carol", "bob"]})
            assert again.json() == first.json()
            assert len(await _rows(h.maker, GroupMember, group_id=gid)) == 2

            smaller = await h.client.put(f"/groups/{gid}/members", json={"usernames": ["carol"]})
            assert smaller.json()["members"] == ["carol"] and smaller.json()["member_count"] == 1

            cleared = await h.client.put(f"/groups/{gid}/members", json={"usernames": []})
            assert cleared.json()["members"] == [] and cleared.json()["member_count"] == 0
            assert await _rows(h.maker, GroupMember, group_id=gid) == []

            unknown = await h.client.put(f"/groups/{gid}/members", json={"usernames": ["ghost"]})
            assert unknown.status_code == 400

    asyncio.run(scenario())


def test_delete_group_cascades_members_grants_and_owners(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            sid = ids["session"]
            h.as_user("admin", admin=True)
            gid = (await _create(h, "f1-team"))["id"]
            await h.client.put(f"/groups/{gid}/members", json={"usernames": ["bob"]})
            await h.client.post(f"/shares/session/{sid}/group/{gid}", json={"capabilities": ["OPERATE"]})
            await h.client.put(f"/shares/session/{sid}/owner-group/{gid}")

            assert len(await _rows(h.maker, ResourceAccess, group_id=gid)) == 2
            assert len(await _rows(h.maker, ResourceOwnerGroup, group_id=gid)) == 1

            assert (await h.client.delete(f"/groups/{gid}")).status_code == 200
            assert await _rows(h.maker, GroupMember, group_id=gid) == []
            assert await _rows(h.maker, ResourceAccess, group_id=gid) == []
            assert await _rows(h.maker, ResourceOwnerGroup, group_id=gid) == []

    asyncio.run(scenario())


def test_delete_user_removes_memberships_and_owner_rows(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            h.as_user("admin", admin=True)
            gid = (await _create(h, "f1-team"))["id"]
            await h.client.put(f"/groups/{gid}/members", json={"usernames": ["bob", "carol"]})
            await h.client.put(f"/shares/session/{ids['session']}/owner-user/bob")

            assert (await h.client.delete("/auth/users/bob")).status_code == 200
            members = await _rows(h.maker, GroupMember, group_id=gid)
            assert [row.username for row in members] == ["carol"]
            assert await _rows(h.maker, ResourceOwnerUser, username="bob") == []

    asyncio.run(scenario())


# ── Grants ──────────────────────────────────────────────────────────────────

def test_group_grant_confers_on_member_only(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            sid = ids["session"]
            h.as_user("admin", admin=True)
            gid = (await _create(h, "f1-team"))["id"]
            await h.client.put(f"/groups/{gid}/members", json={"usernames": ["bob"]})

            granted = await h.client.post(
                f"/shares/session/{sid}/group/{gid}", json={"capabilities": ["OPERATE"]}
            )
            assert granted.status_code == 200, granted.text
            assert granted.json()["group_grants"] == [{
                "group_id": gid, "name": "f1-team", "display_name": "",
                "system": False, "capabilities": ["VIEW", "OPERATE"],
            }]

            h.as_user("bob")
            assert sid in [s["id"] for s in (await h.client.get("/sessions/")).json()["items"]]
            with patch("mirrorr.api.routers.crud._send_control", AsyncMock(return_value={"status": "stopping"})):
                assert (await h.client.post(f"/sessions/{sid}/stop")).status_code == 200

            h.as_user("carol")
            assert sid not in [s["id"] for s in (await h.client.get("/sessions/")).json()["items"]]
            assert (await h.client.get(f"/sessions/{sid}")).status_code == 403

    asyncio.run(scenario())


def test_everyone_grant_confers_on_any_user(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            sid = ids["session"]
            h.as_user("admin", admin=True)
            gid = await _everyone_id(h.client)
            await h.client.post(f"/shares/session/{sid}/group/{gid}", json={"capabilities": ["VIEW"]})

            h.as_user("carol")
            assert sid in [s["id"] for s in (await h.client.get("/sessions/")).json()["items"]]
            assert (await h.client.get(f"/sessions/{sid}")).status_code == 200

    asyncio.run(scenario())


def test_group_grant_implies_view_and_replace_sets(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            sid = ids["session"]
            h.as_user("admin", admin=True)
            gid = (await _create(h, "f1-team"))["id"]
            await h.client.put(f"/groups/{gid}/members", json={"usernames": ["bob"]})

            stored = await h.client.post(f"/shares/session/{sid}/group/{gid}", json={"capabilities": ["OPERATE"]})
            assert stored.json()["group_grants"][0]["capabilities"] == ["VIEW", "OPERATE"]
            assert sorted(r.capability.value for r in await _rows(h.maker, ResourceAccess, group_id=gid)) == ["OPERATE", "VIEW"]

            replaced = await h.client.post(f"/shares/session/{sid}/group/{gid}", json={"capabilities": ["EDIT"]})
            assert replaced.json()["group_grants"][0]["capabilities"] == ["VIEW", "EDIT"]

            cleared = await h.client.post(f"/shares/session/{sid}/group/{gid}", json={"capabilities": []})
            assert cleared.json()["group_grants"] == []
            assert await _rows(h.maker, ResourceAccess, group_id=gid) == []

            assert (await h.client.post(f"/shares/session/{sid}/group/{gid}", json={"capabilities": ["VIEW"]})).status_code == 200
            assert (await h.client.delete(f"/shares/session/{sid}/group/{gid}")).json()["group_grants"] == []

            for call in await asyncio.gather(
                h.client.post(f"/shares/session/{sid}/group/999", json={"capabilities": ["VIEW"]}),
                h.client.delete(f"/shares/session/{sid}/group/999"),
                h.client.put(f"/shares/session/{sid}/owner-group/999"),
                h.client.delete(f"/shares/session/{sid}/owner-group/999"),
            ):
                assert call.status_code == 404, call.text

            caps = await _caps(h.maker, "bob", sid)
            assert caps[Capability.VIEW] is False and caps[Capability.OPERATE] is False

    asyncio.run(scenario())


def test_owner_group_is_additive_and_idempotent(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            sid = ids["session"]
            h.as_user("admin", admin=True)
            gid = (await _create(h, "f1-team"))["id"]
            await h.client.put(f"/groups/{gid}/members", json={"usernames": ["bob"]})

            owned = await h.client.put(f"/shares/session/{sid}/owner-group/{gid}")
            assert owned.status_code == 200, owned.text
            assert owned.json()["owner"] == "alice"
            assert owned.json()["owner_groups"] == [
                {"id": gid, "name": "f1-team", "display_name": "", "system": False}
            ]
            assert len(await _rows(h.maker, ResourceOwnerGroup, group_id=gid)) == 1

            assert (await h.client.put(f"/shares/session/{sid}/owner-group/{gid}")).json() == owned.json()
            assert len(await _rows(h.maker, ResourceOwnerGroup, group_id=gid)) == 1

            assert all((await _caps(h.maker, "bob", sid)).values())
            assert (await h.client.get(f"/shares/session/{sid}")).json()["owner"] == "alice"
            assert sid in [s["id"] for s in (await h.client.get("/sessions/")).json()["items"]]

            removed = await h.client.delete(f"/shares/session/{sid}/owner-group/{gid}")
            assert removed.json()["owner_groups"] == []
            assert await _rows(h.maker, ResourceOwnerGroup, group_id=gid) == []
            assert not any((await _caps(h.maker, "bob", sid)).values())
            assert (await h.client.get(f"/shares/session/{sid}")).json()["owner"] == "alice"

    asyncio.run(scenario())


def test_owner_user_is_additive_and_idempotent(tmp_path):
    """Owners are a list: adding a user never moves the requester."""
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            sid = ids["session"]
            h.as_user("admin", admin=True)

            owned = await h.client.put(f"/shares/session/{sid}/owner-user/bob")
            assert owned.status_code == 200, owned.text
            assert owned.json()["owner"] == "alice"
            assert owned.json()["owner_users"] == ["bob"]
            assert len(await _rows(h.maker, ResourceOwnerUser, username="bob")) == 1

            assert (await h.client.put(f"/shares/session/{sid}/owner-user/bob")).json() == owned.json()
            assert len(await _rows(h.maker, ResourceOwnerUser, username="bob")) == 1

            # SHARE is self-escalatory for a holder, so the refuser has to be a
            # stranger with no capability of their own.
            h.as_user("carol")
            assert (await h.client.put(f"/shares/session/{sid}/owner-user/carol")).status_code == 403

            h.as_user("admin", admin=True)
            both = await h.client.put(f"/shares/session/{sid}/owner-user/carol")
            assert both.json()["owner_users"] == ["bob", "carol"]
            assert all((await _caps(h.maker, "bob", sid)).values())

            h.as_user("bob")
            assert sid in [s["id"] for s in (await h.client.get("/sessions/")).json()["items"]]
            assert (await h.client.get(f"/sessions/{sid}")).status_code == 200

            h.as_user("admin", admin=True)
            removed = await h.client.delete(f"/shares/session/{sid}/owner-user/bob")
            assert removed.json()["owner_users"] == ["carol"]
            assert await _rows(h.maker, ResourceOwnerUser, username="bob") == []
            assert not any((await _caps(h.maker, "bob", sid)).values())
            assert (await h.client.get(f"/shares/session/{sid}")).json()["owner"] == "alice"

            assert (await h.client.put(f"/shares/session/{sid}/owner-user/nobody")).status_code == 400

    asyncio.run(scenario())


# ── Migration ───────────────────────────────────────────────────────────────

async def _probe_resource_access(engine) -> dict:
    async with engine.connect() as conn:
        def _probe(sync_conn) -> dict:
            inspector_obj = inspect(sync_conn)
            return {
                "columns": [c["name"] for c in inspector_obj.get_columns("resource_access")],
                "rows": sync_conn.exec_driver_sql(
                    "SELECT resource_type, resource_id, username, capability "
                    "FROM resource_access ORDER BY id"
                ).fetchall(),
                "unique": [
                    tuple(uc["column_names"])
                    for uc in inspector_obj.get_unique_constraints("resource_access")
                ],
            }
        return await conn.run_sync(_probe)


def test_rebuild_preserves_user_rows_and_adds_group_columns(tmp_path):
    async def _run():
        engine, _ = create_db_engine(MirrorrSettings(base_dir=tmp_path))
        async with engine.begin() as conn:
            await conn.exec_driver_sql(
                "CREATE TABLE resource_access ("
                "id INTEGER NOT NULL, resource_type VARCHAR(9), resource_id INTEGER NOT NULL, "
                "username VARCHAR NOT NULL, created_at DATETIME NOT NULL, "
                "PRIMARY KEY (id), UNIQUE (resource_type, resource_id, username))"
            )
            await conn.run_sync(SQLModel.metadata.create_all)
            await conn.exec_driver_sql(
                "INSERT INTO resource_access (resource_type, resource_id, username, created_at) "
                "VALUES ('SESSION', 1, 'bob', '2024-01-01 00:00:00')"
            )
        await ensure_db(engine)
        first = await _probe_resource_access(engine)
        await ensure_db(engine)
        second = await _probe_resource_access(engine)
        await engine.dispose()
        return first, second

    first, second = asyncio.run(_run())
    assert {"group_id", "capability"} <= set(first["columns"])
    assert first["rows"] == [("SESSION", 1, "bob", "VIEW")]
    assert set(first["unique"]) == {
        ("resource_type", "resource_id", "username", "capability"),
        ("resource_type", "resource_id", "group_id", "capability"),
    }
    assert first == second
