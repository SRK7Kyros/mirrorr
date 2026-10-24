"""Admin resource listing/owner routes + the sharing boundary.

Grants now flow through the ``/shares/`` surface (see ``test_shares.py``); here a
``VIEW`` grant admits reads — a granted viewer sees a resource's list row, detail
and logs — plus the ways a seen item is *reused* in the viewer's own items
(starting a session/autorun from it, cloning it to a profile), and nothing that
mutates it: control / update / delete / export stay owner-or-admin (or the
matching capability).
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from httpx import ASGITransport, AsyncClient
from fastapi import Request
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import SQLModel, select
from sqlmodel.ext.asyncio.session import AsyncSession as SQLModelAsyncSession
from unittest.mock import AsyncMock, patch

from mirrorr.api.api import API
from mirrorr.api.dependencies import AuthState, _get_db, get_auth
from mirrorr.di import container
from mirrorr.plugin_api.interfaces import Capabilities
from mirrorr.storage.enums import ResourceType, SessionStatus, UserRole
from mirrorr.storage.models import (
    Autorun,
    Engine,
    EventSubscription,
    Notification,
    Profile,
    Recording,
    Resolver,
    ResolverSource,
    ResourceAccess,
    ResourceOwnerUser,
    Session,
    User,
)
from mirrorr.services import session_lifecycle
from mirrorr.startup.config import MirrorrSettings

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
        db_factory=maker,
        event_bus=AsyncMock(),
    )
    holder: dict = {"auth": AuthState(client=None, user=None)}

    async def _db():
        async with maker() as db:
            yield db

    def _auth(request: Request):
        current = holder["auth"]
        request.state.is_admin = current.is_admin
        return current

    API.dependency_overrides[_get_db] = _db
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
        db.add_all([User(username="alice", role=UserRole.ADMIN), User(username="bob"), User(username="carol")])
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

        autorun = Autorun(
            user_friendly_name="Alice Evening",
            snake_case_name="alice_evening",
            profile_id=alice_profile.id,
            engine_id=eid,
            resolver_id=rid,
            start_time=NOW,
            end_time=NOW,
            requester_user_token="alice",
        )
        db.add(autorun)
        await db.commit()
        session = Session(
            autorun_id=autorun.id,
            profile_id=alice_profile.id,
            engine_id=eid,
            resolver_id=rid,
            status=SessionStatus.COMPLETED,
            requester_user_token="alice",
        )
        recording = Recording(
            user_friendly_name="Alice Rec",
            snake_case_name="alice_rec",
            disk_path="/tmp/alice_rec.ts",
            content_url="http://h/content/alice_rec.ts",
            profile_name="Alice News",
            engine_name="yt_dlp_piped",
            resolver_name="static",
            started_at=NOW,
            ended_at=NOW,
            duration_seconds=1.0,
            size_bytes=10,
            requester_user_token="alice",
        )
        db.add_all([autorun, session, recording])
        await db.commit()
        return {
            "engine": eid,
            "resolver": rid,
            "profile": alice_profile.id,
            "ghost_profile": ghost_profile.id,
            "source": source.id,
            "autorun": autorun.id,
            "session": session.id,
            "recording": recording.id,
        }


async def _grant_rows(maker, resource_type: ResourceType | None = None, username: str | None = None) -> list:
    async with maker() as db:
        stmt = select(ResourceAccess)
        if resource_type is not None:
            stmt = stmt.where(ResourceAccess.resource_type == resource_type)
        if username is not None:
            stmt = stmt.where(ResourceAccess.username == username)
        return list((await db.exec(stmt)).all())


async def _owner_rows(maker, resource_type: ResourceType | None = None, username: str | None = None) -> list:
    async with maker() as db:
        stmt = select(ResourceOwnerUser)
        if resource_type is not None:
            stmt = stmt.where(ResourceOwnerUser.resource_type == resource_type)
        if username is not None:
            stmt = stmt.where(ResourceOwnerUser.username == username)
        return list((await db.exec(stmt)).all())


def test_admin_listing_labels_system_rows_and_missing_owner(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            h.as_user("alice", admin=True)

            resp = await h.client.get("/admin/resources")
            assert resp.status_code == 200
            body = resp.json()
            rows = {(r["resource_type"], r["id"]): r for r in body["items"]}
            assert body["total"] == len(body["items"]) == 8

            engine_row = rows[("engine", ids["engine"])]
            assert engine_row["system"] is True and engine_row["owner"] == ""
            assert engine_row["label"] == "yt_dlp_piped" and engine_row["viewer_count"] == 0
            resolver_row = rows[("resolver", ids["resolver"])]
            assert resolver_row["system"] is True and resolver_row["label"] == "static"

            assert rows[("session", ids["session"])]["label"] == "Alice Evening"
            assert rows[("autorun", ids["autorun"])]["label"] == "Alice Evening"
            assert rows[("recording", ids["recording"])]["label"] == "alice_rec.ts"
            assert rows[("profile", ids["profile"])]["label"] == "Alice News"
            assert rows[("source", ids["source"])]["label"] == "Alice Source"

            ghost = rows[("profile", ids["ghost_profile"])]
            assert ghost["owner"] == "ghost" and ghost["owner_missing"] is True
            assert rows[("profile", ids["profile"])]["owner_missing"] is False

            only_engines = (await h.client.get("/admin/resources?resource_type=engine")).json()
            assert only_engines["total"] == 1 and only_engines["items"][0]["system"] is True

            owned = (await h.client.get("/admin/resources?owner=alice")).json()
            assert owned["total"] == 5
            assert all(r["resource_type"] not in ("engine", "resolver") for r in owned["items"])

            assert (await h.client.get("/admin/resources?resource_type=user")).status_code == 400
            assert (await h.client.get("/admin/resources?resource_type=bogus")).status_code == 400

    asyncio.run(scenario())


def test_grant_revoke_transfer_and_validation(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            h.as_user("alice", admin=True)
            sid = ids["session"]

            grant = {"username": "bob", "capabilities": ["VIEW"]}
            assert (await h.client.post("/shares/user/1", json=grant)).status_code == 400
            assert (await h.client.post("/shares/engine/1", json=grant)).status_code == 400
            assert (await h.client.post("/shares/bogus/1", json=grant)).status_code == 404
            assert (await h.client.post("/shares/session/999", json=grant)).status_code == 404
            assert (await h.client.post(f"/shares/session/{sid}", json={"username": "nobody", "capabilities": ["VIEW"]})).status_code == 400

            granted = await h.client.post(f"/shares/session/{sid}", json=grant)
            assert granted.status_code == 200
            assert granted.json() == {
                "resource_type": "session", "id": sid, "owner": "alice", "owner_group_id": None,
                "owner_missing": False,
                "grants": [{"username": "bob", "capabilities": ["VIEW"]}],
                "owner_users": [], "owner_groups": [], "group_grants": [],
            }
            again = await h.client.post(f"/shares/session/{sid}", json=grant)
            assert again.status_code == 200 and again.json() == granted.json()
            assert len(await _grant_rows(h.maker, username="bob")) == 1

            detail = await h.client.get(f"/shares/session/{sid}")
            assert detail.status_code == 200
            assert detail.json() == granted.json()

            listed = (await h.client.get("/admin/resources?resource_type=session")).json()
            assert listed["items"][0]["viewer_count"] == 1

            revoked = await h.client.delete(f"/shares/session/{sid}/bob")
            assert revoked.status_code == 200 and revoked.json()["grants"] == []
            assert (await h.client.delete(f"/shares/session/{sid}/bob")).status_code == 200

            assert (await h.client.put(f"/admin/resources/session/{sid}/owner", json={"username": "nobody"})).status_code == 400
            moved = await h.client.put(f"/admin/resources/session/{sid}/owner", json={"username": "carol"})
            assert moved.status_code == 200
            assert moved.json() == {"resource_type": "session", "id": sid, "owner": "carol", "owner_group_id": None}

    asyncio.run(scenario())


def test_a8_admin_endpoints_reject_non_admin(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            h.as_user("bob")
            sid = ids["session"]
            calls = [
                h.client.get("/admin/resources"),
                h.client.put(f"/admin/resources/session/{sid}/owner", json={"username": "bob"}),
            ]
            for response in await asyncio.gather(*calls):
                assert response.status_code == 403, response.text

            removed = [
                h.client.get(f"/admin/resources/session/{sid}/access"),
                h.client.post(f"/admin/resources/session/{sid}/access", json={"username": "bob"}),
                h.client.delete(f"/admin/resources/session/{sid}/access/bob"),
            ]
            for response in await asyncio.gather(*removed):
                assert response.status_code == 404, response.text

    asyncio.run(scenario())


def test_a1_granted_viewer_reads_list_detail_and_logs(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            h.as_user("alice", admin=True)
            for tag, rid in (("session", ids["session"]), ("profile", ids["profile"])):
                assert (await h.client.post(f"/shares/{tag}/{rid}", json={"username": "bob", "capabilities": ["VIEW"]})).status_code == 200

            h.as_user("bob")
            sessions = (await h.client.get("/sessions/")).json()["items"]
            assert ids["session"] in [s["id"] for s in sessions]
            assert (await h.client.get(f"/sessions/{ids['session']}")).status_code == 200
            assert (await h.client.get(f"/sessions/{ids['session']}/logs")).status_code == 200
            profiles = (await h.client.get("/profiles/")).json()["items"]
            assert ids["profile"] in [p["id"] for p in profiles]
            assert (await h.client.get(f"/profiles/{ids['profile']}")).status_code == 200

    asyncio.run(scenario())


def test_a2_without_grant_viewer_is_excluded(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            h.as_user("bob")
            sessions = (await h.client.get("/sessions/")).json()["items"]
            assert ids["session"] not in [s["id"] for s in sessions]
            assert (await h.client.get(f"/sessions/{ids['session']}")).status_code == 403
            assert (await h.client.get(f"/sessions/{ids['session']}/logs")).status_code == 403
            assert (await h.client.get(f"/profiles/{ids['profile']}")).status_code == 403

    asyncio.run(scenario())


def test_operate_grant_also_reads_and_stops(tmp_path):
    """VIEW is the base: an OPERATE grant admits list, detail and the operate
    action (via the implied VIEW), but never DELETE/EDIT."""
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            sid = ids["session"]
            h.as_user("alice", admin=True)
            granted = await h.client.post(f"/shares/session/{sid}", json={"username": "bob", "capabilities": ["OPERATE"]})
            assert granted.status_code == 200, granted.text
            assert granted.json()["grants"] == [{"username": "bob", "capabilities": ["VIEW", "OPERATE"]}]

            h.as_user("bob")
            sessions = (await h.client.get("/sessions/")).json()["items"]
            assert sid in [s["id"] for s in sessions]
            assert (await h.client.get(f"/sessions/{sid}")).status_code == 200
            assert (await h.client.get(f"/sessions/{sid}/logs")).status_code == 200
            with patch("mirrorr.api.routers.crud._send_control", AsyncMock(return_value={"status": "stopping"})):
                assert (await h.client.post(f"/sessions/{sid}/stop")).status_code == 200
            assert (await h.client.delete(f"/sessions/{sid}")).status_code == 403
            assert (await h.client.put(f"/profiles/{ids['profile']}", json={"name": "x"})).status_code == 403

    asyncio.run(scenario())


def test_a3_revoke_removes_view(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            sid = ids["session"]
            h.as_user("alice", admin=True)
            await h.client.post(f"/shares/session/{sid}", json={"username": "bob", "capabilities": ["VIEW"]})
            h.as_user("bob")
            assert ids["session"] in [s["id"] for s in (await h.client.get("/sessions/")).json()["items"]]

            h.as_user("alice", admin=True)
            await h.client.delete(f"/shares/session/{sid}/bob")
            h.as_user("bob")
            assert ids["session"] not in [s["id"] for s in (await h.client.get("/sessions/")).json()["items"]]
            assert (await h.client.get(f"/sessions/{sid}")).status_code == 403

    asyncio.run(scenario())


def test_a4_transfer_moves_control_and_removes_old_owner(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            aid = ids["autorun"]
            h.as_user("alice")
            assert (await h.client.get(f"/autoruns/{aid}")).status_code == 200

            h.as_user("alice", admin=True)
            moved = await h.client.put(f"/admin/resources/autorun/{aid}/owner", json={"username": "bob"})
            assert moved.status_code == 200 and moved.json()["owner"] == "bob"

            h.as_user("alice")
            assert (await h.client.get(f"/autoruns/{aid}")).status_code == 403
            assert (await h.client.put(f"/autoruns/{aid}", json={"user_friendly_name": "x"})).status_code == 403
            assert (await h.client.delete(f"/autoruns/{aid}")).status_code == 403

            h.as_user("bob")
            assert (await h.client.get(f"/autoruns/{aid}")).status_code == 200
            assert (await h.client.delete(f"/autoruns/{aid}")).status_code == 200

    asyncio.run(scenario())


def test_a7_a_grant_confers_no_mutation_powers_but_a_profile_may_be_used(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            h.as_user("alice", admin=True)
            for tag in ("session", "profile", "autorun", "source", "recording"):
                assert (await h.client.post(f"/shares/{tag}/{ids[tag]}", json={"username": "bob", "capabilities": ["VIEW"]})).status_code == 200

            h.as_user("bob")
            sid, pid, aid = ids["session"], ids["profile"], ids["autorun"]
            assert (await h.client.post(f"/sessions/{sid}/stop")).status_code == 403
            assert (await h.client.post(f"/sessions/{sid}/recording/enable")).status_code == 403
            assert (await h.client.post(f"/sessions/{sid}/recording/disable")).status_code == 403
            assert (await h.client.delete(f"/sessions/{sid}")).status_code == 403
            for url, name in (
                (f"/sessions/{sid}/save-as-profile", "from session"),
                (f"/autoruns/{aid}/save-as-profile", "from autorun"),
            ):
                cloned = await h.client.post(url, json={"name": name})
                assert cloned.status_code == 200, f"{url}: {cloned.text}"
                async with h.maker() as db:
                    assert (await db.get(Profile, cloned.json()["id"])).requester_user_token == "bob"
            assert (await h.client.put(f"/autoruns/{aid}", json={"user_friendly_name": "mine"})).status_code == 403
            assert (await h.client.delete(f"/autoruns/{aid}")).status_code == 403
            assert (await h.client.get(f"/import-export/profiles/{pid}/export")).status_code == 403
            assert (await h.client.get(f"/import-export/autoruns/{aid}/export")).status_code == 403
            assert (await h.client.put(f"/profiles/{pid}", json={"name": "mine"})).status_code == 403
            assert (await h.client.delete(f"/profiles/{pid}")).status_code == 403
            assert (await h.client.delete(f"/sources/{ids['source']}")).status_code == 403
            assert (await h.client.delete(f"/recordings/{ids['recording']}")).status_code == 403
            linked = await h.client.post("/sessions/", json={"profile_id": pid})
            assert linked.status_code == 200, linked.text
            assert linked.json()["profile_id"] == pid
            async with h.maker() as db:
                theirs = await db.get(Session, linked.json()["id"])
                assert theirs.requester_user_token == "bob"
                assert (await db.get(Profile, pid)).name == "Alice News"

    asyncio.run(scenario())


def test_a6_deletes_drop_grants(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            h.as_user("alice", admin=True)
            aid, pid = ids["autorun"], ids["profile"]
            await h.client.post(f"/shares/autorun/{aid}", json={"username": "bob", "capabilities": ["VIEW"]})
            await h.client.post(f"/shares/profile/{pid}", json={"username": "bob", "capabilities": ["VIEW"]})
            await h.client.put(f"/shares/autorun/{aid}/owner-user/bob")
            await h.client.put(f"/shares/profile/{pid}/owner-user/bob")
            assert len(await _grant_rows(h.maker, username="bob")) == 2
            assert len(await _owner_rows(h.maker, username="bob")) == 2

            assert (await h.client.delete(f"/autoruns/{aid}")).status_code == 200
            remaining = await _grant_rows(h.maker, resource_type=ResourceType.AUTORUN)
            assert remaining == []
            assert await _owner_rows(h.maker, resource_type=ResourceType.AUTORUN) == []
            assert len(await _grant_rows(h.maker, username="bob")) == 1
            assert len(await _owner_rows(h.maker, username="bob")) == 1

            assert (await h.client.delete("/auth/users/bob")).status_code == 200
            assert await _grant_rows(h.maker, username="bob") == []
            assert await _owner_rows(h.maker, username="bob") == []

    asyncio.run(scenario())


# ── Review-gate pins: F1 (token leak) · F2 (lifecycle cleanup) · F3 (race) ──

_RESOURCE_ROUTES = {
    "session": "/sessions/{id}",
    "autorun": "/autoruns/{id}",
    "recording": "/recordings/{id}",
    "profile": "/profiles/{id}",
    "source": "/sources/{id}",
}


def test_granted_source_viewer_never_receives_owner_token(tmp_path):
    """F1: a granted (non-admin) viewer of a source must not receive requester_user_token."""
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            source_id = ids["source"]
            h.as_user("alice", admin=True)
            assert (await h.client.post(f"/shares/source/{source_id}", json={"username": "bob", "capabilities": ["VIEW"]})).status_code == 200

            h.as_user("bob")
            detail = await h.client.get(f"/sources/{source_id}")
            assert detail.status_code == 200, detail.text
            assert "requester_user_token" not in detail.json()
            listed = (await h.client.get("/sources/")).json()["items"]
            assert listed and all("requester_user_token" not in row for row in listed)

            h.as_user("alice", admin=True)
            assert (await h.client.get(f"/sources/{source_id}")).json()["requester_user_token"] == "alice"

    asyncio.run(scenario())


def test_a6_every_kind_drops_its_grants_on_delete(tmp_path):
    async def scenario():
        for tag, route in _RESOURCE_ROUTES.items():
            sub = tmp_path / f"a6-{tag}"
            sub.mkdir(parents=True, exist_ok=True)
            async with _harness(sub) as h:
                ids = await _seed(h.maker)
                rid = ids[tag]
                h.as_user("alice", admin=True)
                granted = await h.client.post(f"/shares/{tag}/{rid}", json={"username": "bob", "capabilities": ["VIEW"]})
                assert granted.status_code == 200, granted.text
                assert await _grant_rows(h.maker, resource_type=ResourceType(tag), username="bob")

                h.as_user("alice")
                deleted = await h.client.delete(route.format(id=rid))
                assert deleted.status_code == 200, deleted.text
                assert await _grant_rows(h.maker, resource_type=ResourceType(tag)) == []
                assert await _grant_rows(h.maker, username="bob") == []

    asyncio.run(scenario())


def test_a4_transfer_moves_owner_for_every_kind(tmp_path):
    async def scenario():
        for tag, route in _RESOURCE_ROUTES.items():
            sub = tmp_path / f"a4-{tag}"
            sub.mkdir(parents=True, exist_ok=True)
            async with _harness(sub) as h:
                ids = await _seed(h.maker)
                rid = ids[tag]
                h.as_user("alice", admin=True)
                moved = await h.client.put(f"/admin/resources/{tag}/{rid}/owner", json={"username": "carol"})
                assert moved.status_code == 200, moved.text
                assert moved.json() == {"resource_type": tag, "id": rid, "owner": "carol", "owner_group_id": None}

                h.as_user("alice")
                assert (await h.client.get(route.format(id=rid))).status_code == 403, tag
                h.as_user("carol")
                assert (await h.client.get(route.format(id=rid))).status_code == 200, tag

    asyncio.run(scenario())


def test_a6_lifecycle_path_cleans_subscriptions_notifications_and_grants(tmp_path):
    """F2: the scheduler-side delete_session must clean the same related records
    as the API cascade (subscriptions + notifications + grants)."""
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            sid = ids["session"]
            async with h.maker() as db:
                alice = (await db.exec(select(User).where(User.username == "alice"))).one()
                db.add(EventSubscription(user_id=alice.id, resource_type="session", resource_id=sid))
                db.add(Notification(user_id=alice.id, resource_type="session", resource_id=sid, event_type="session.started", title="t"))
                db.add(ResourceAccess(resource_type=ResourceType.SESSION, resource_id=sid, username="bob"))
                await db.commit()

            await session_lifecycle.delete_session(container.settings, sid)

            async with h.maker() as db:
                for model in (EventSubscription, Notification, ResourceAccess, Session):
                    rows = (await db.exec(select(model).where(model.id == sid) if model is Session else select(model).where(model.resource_id == sid))).all()
                    assert rows == [], model.__name__

    asyncio.run(scenario())


def test_a1_granted_viewer_reads_recording_progress(tmp_path):
    """F5: the recording-progress GET shares _resolve_own_session, so a grant admits it too."""
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            sid = ids["session"]
            h.as_user("alice", admin=True)
            await h.client.post(f"/shares/session/{sid}", json={"username": "bob", "capabilities": ["VIEW"]})

            h.as_user("bob")
            assert (await h.client.get(f"/sessions/{sid}/recording/progress")).status_code == 200
            h.as_user("carol")
            assert (await h.client.get(f"/sessions/{sid}/recording/progress")).status_code == 403

    asyncio.run(scenario())


def test_a7_a_granted_profile_is_usable_as_a_capture_target(tmp_path):
    """A profile shared for use is a template: VIEW may point an autorun at it.

    The autorun copies the profile's capture into its own row and never touches
    the profile, so this is a read of the template, not an edit of it.
    """
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            h.as_user("alice", admin=True)
            await h.client.post(f"/shares/profile/{ids['profile']}", json={"username": "bob", "capabilities": ["VIEW"]})

            h.as_user("bob")
            payload = {
                "user_friendly_name": "Bob Evening",
                "snake_case_name": "bob_evening",
                "profile_id": ids["profile"],
                "start_time": NOW.isoformat(),
                "end_time": (NOW + timedelta(hours=1)).isoformat(),
            }
            resp = await h.client.post("/autoruns/", json=payload)
            assert resp.status_code == 200, resp.text
            assert resp.json()["profile_id"] == ids["profile"]
            assert resp.json()["engine_id"] == ids["engine"]
            async with h.maker() as db:
                theirs = await db.get(Autorun, resp.json()["id"])
                assert theirs.requester_user_token == "bob"
                assert (await db.get(Profile, ids["profile"])).name == "Alice News"

    asyncio.run(scenario())


def test_a7_deleting_a_profile_detaches_another_users_session(tmp_path):
    """Deleting a shared template must not destroy what someone else built from it."""
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            h.as_user("alice", admin=True)
            await h.client.post(f"/shares/profile/{ids['profile']}", json={"username": "bob", "capabilities": ["VIEW"]})

            h.as_user("bob")
            created = await h.client.post("/sessions/", json={"profile_id": ids["profile"]})
            assert created.status_code == 200, created.text
            sid = created.json()["id"]

            h.as_user("alice")
            resp = await h.client.delete(f"/profiles/{ids['profile']}")
            assert resp.status_code == 200, resp.text
            assert resp.json()["deleted"]["detached"] == 1

            h.as_user("bob")
            kept = await h.client.get(f"/sessions/{sid}")
            assert kept.status_code == 200, kept.text
            assert kept.json()["profile_id"] is None

    asyncio.run(scenario())


def test_a9_owner_scoping_unchanged_without_grants(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)

            h.as_user("bob")
            for tag, route in _RESOURCE_ROUTES.items():
                assert (await h.client.get(route.format(id=ids[tag]))).status_code == 403, tag
                items = (await h.client.get(f"/{tag}s/")).json()["items"]
                assert ids[tag] not in [i["id"] for i in items], tag

            h.as_user("alice")
            for tag, route in _RESOURCE_ROUTES.items():
                assert (await h.client.get(route.format(id=ids[tag]))).status_code == 200, tag
                items = (await h.client.get(f"/{tag}s/")).json()["items"]
                assert ids[tag] in [i["id"] for i in items], tag

    asyncio.run(scenario())


def test_concurrent_double_grant_is_idempotent(tmp_path):
    """F3: two concurrent grants race select→insert; the loser hits the UNIQUE
    constraint and must still answer 200 (documented idempotent POST), not 500."""
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            sid = ids["session"]
            h.as_user("alice", admin=True)

            import mirrorr.api.routers.auth as auth_routes

            original = auth_routes._known_username
            barrier = asyncio.Barrier(2)

            async def synced_known(db, username):
                await original(db, username)
                await barrier.wait()

            auth_routes._known_username = synced_known
            try:
                first, second = await asyncio.wait_for(
                    asyncio.gather(
                        h.client.post(f"/shares/session/{sid}", json={"username": "bob", "capabilities": ["VIEW"]}),
                        h.client.post(f"/shares/session/{sid}", json={"username": "bob", "capabilities": ["VIEW"]}),
                    ),
                    timeout=10,
                )
            finally:
                auth_routes._known_username = original

            assert first.status_code == 200, first.text
            assert second.status_code == 200, second.text
            expected = {"username": "bob", "capabilities": ["VIEW"]}
            assert first.json()["grants"] == [expected]
            assert second.json()["grants"] == [expected]
            assert len(await _grant_rows(h.maker, resource_type=ResourceType.SESSION, username="bob")) == 1

    asyncio.run(scenario())


def test_primary_owner_may_be_a_group(tmp_path):
    """The crown may be handed to a group: its members then hold all six
    capabilities, the wire names which kind of primary owner it is, and it is
    never both kinds at once."""
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            sid = ids["session"]
            h.as_user("alice", admin=True)
            created = await h.client.post("/groups", json={"name": "ops", "display_name": "Operations"})
            assert created.status_code == 200, created.text
            gid = created.json()["id"]
            members = await h.client.put(f"/groups/{gid}/members", json={"usernames": ["bob"]})
            assert members.status_code == 200, members.text

            moved = await h.client.put(f"/admin/resources/session/{sid}/owner", json={"group_id": gid})
            assert moved.status_code == 200, moved.text
            assert moved.json() == {"resource_type": "session", "id": sid, "owner": "", "owner_group_id": gid}

            h.as_user("bob")
            view = (await h.client.get(f"/shares/session/{sid}")).json()
            assert view["owner"] == "" and view["owner_group_id"] == gid and view["owner_missing"] is False
            assert (await h.client.get(f"/sessions/{sid}")).status_code == 200
            h.as_user("carol")
            assert (await h.client.get(f"/sessions/{sid}")).status_code == 403
            assert (await h.client.get(f"/shares/session/{sid}")).status_code == 403

            h.as_user("alice", admin=True)
            row = (await h.client.get("/admin/resources?resource_type=session")).json()["items"][0]
            assert row["owner"] == "ops" and row["owner_group_id"] == gid and row["owner_missing"] is False
            filtered = (await h.client.get("/admin/resources?resource_type=session&owner=ops")).json()
            assert [item["id"] for item in filtered["items"]] == [sid]

            back = await h.client.put(f"/admin/resources/session/{sid}/owner", json={"username": "carol"})
            assert back.status_code == 200
            assert back.json() == {"resource_type": "session", "id": sid, "owner": "carol", "owner_group_id": None}
            row = (await h.client.get("/admin/resources?resource_type=session")).json()["items"][0]
            assert row["owner"] == "carol" and row["owner_group_id"] is None

            assert (await h.client.put(f"/admin/resources/session/{sid}/owner", json={})).status_code == 400
            both = {"username": "carol", "group_id": gid}
            assert (await h.client.put(f"/admin/resources/session/{sid}/owner", json=both)).status_code == 400
            assert (await h.client.put(f"/admin/resources/session/{sid}/owner", json={"group_id": 999})).status_code == 404

            # A crown handed to a group that is then deleted leaves a stale group
            # id — the group analogue of a stale owner token: the item survives,
            # nobody but an admin reaches it, and both views report owner_missing.
            assert (
                await h.client.put(f"/admin/resources/session/{sid}/owner", json={"group_id": gid})
            ).status_code == 200
            assert (await h.client.delete(f"/groups/{gid}")).status_code == 200
            view = (await h.client.get(f"/shares/session/{sid}")).json()
            assert view["owner"] == "" and view["owner_group_id"] == gid and view["owner_missing"] is True
            row = (await h.client.get("/admin/resources?resource_type=session")).json()["items"][0]
            assert row["owner_group_id"] == gid and row["owner_missing"] is True
            h.as_user("bob")
            assert (await h.client.get(f"/sessions/{sid}")).status_code == 403

    asyncio.run(scenario())
