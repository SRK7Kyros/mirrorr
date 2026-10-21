"""WebSocket authorisation: a live frame reaches exactly the users holding VIEW."""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

from sqlmodel import select

from mirrorr.api import ws
from mirrorr.services.permissions import viewer_usernames
from mirrorr.startup.config import MirrorrSettings
from mirrorr.startup.ensure_db import ensure_db
from mirrorr.storage import database
from mirrorr.storage.database import create_db_engine
from mirrorr.storage.enums import Capability, ResourceType
from mirrorr.storage.models import (
    Engine,
    Group,
    GroupMember,
    Resolver,
    ResourceAccess,
    ResourceOwnerGroup,
    ResourceOwnerUser,
    Session,
    User,
)

VIEWERS = ("alice", "bob", "carol", "dave", "erin")
OUTSIDER = "frank"


class _Socket:
    def __init__(self) -> None:
        self.sent: list[str] = []

    async def send_text(self, text: str) -> None:
        self.sent.append(text)


async def _seeded(tmp_path):
    engine, maker = create_db_engine(MirrorrSettings(base_dir=tmp_path))
    await ensure_db(engine)
    database.set_session_factory(maker)
    ws._audience._cache.clear()
    async with maker() as db:
        db.add(Engine(id=1, name="e", origin="o", origin_hash="h"))
        db.add(
            Resolver(id=1, name="r", description="d", origin="o", origin_hash="h", has_catalog=True)
        )
        db.add_all([User(username=name) for name in (*VIEWERS, OUTSIDER)])
        db.add_all(
            [
                Group(id=10, name="team", display_name="Team"),
                Group(id=11, name="crew", display_name="Crew"),
            ]
        )
        db.add_all(
            [
                GroupMember(group_id=10, username="carol"),
                GroupMember(group_id=11, username="erin"),
            ]
        )
        db.add(Session(id=1, engine_id=1, resolver_id=1, requester_user_token="alice"))
        db.add(Session(id=2, engine_id=1, resolver_id=1, requester_user_token="alice"))
        db.add(
            ResourceOwnerUser(
                resource_type=ResourceType.SESSION, resource_id=1, username="bob"
            )
        )
        db.add(
            ResourceOwnerGroup(
                resource_type=ResourceType.SESSION, resource_id=1, group_id=10
            )
        )
        # OPERATE alone still implies VIEW: any grant is a grant to read.
        db.add(
            ResourceAccess(
                resource_type=ResourceType.SESSION,
                resource_id=1,
                username="dave",
                capability=Capability.OPERATE,
            )
        )
        db.add(
            ResourceAccess(
                resource_type=ResourceType.SESSION,
                resource_id=1,
                group_id=11,
                capability=Capability.VIEW,
            )
        )
        await db.commit()
    return engine, maker


async def _dispatch(subject: str, payload: dict, clients, relay=None) -> None:
    msg = SimpleNamespace(subject=subject, data=json.dumps(payload).encode())
    await (relay or ws._events_relay)._dispatch(msg, clients)


def _client(username: str, admin: bool = False) -> tuple[ws._ClientContext, _Socket]:
    socket = _Socket()
    return ws._ClientContext(socket, username, admin), socket


def test_viewer_usernames_expands_every_principal_kind(tmp_path):
    async def scenario():
        engine, maker = await _seeded(tmp_path)
        async with maker() as db:
            viewers = await viewer_usernames(db, ResourceType.SESSION, 1)
            other = await viewer_usernames(db, ResourceType.SESSION, 2)
        await engine.dispose()
        return viewers, other

    viewers, other = asyncio.run(scenario())

    assert viewers == frozenset(VIEWERS)
    assert other == frozenset({"alice"})


def test_viewer_usernames_is_none_for_a_missing_row(tmp_path):
    async def scenario():
        engine, maker = await _seeded(tmp_path)
        async with maker() as db:
            missing = await viewer_usernames(db, ResourceType.SESSION, 99)
            ownerless = await viewer_usernames(db, ResourceType.USER, 1)
        await engine.dispose()
        return missing, ownerless

    assert asyncio.run(scenario()) == (None, None)


def test_viewer_usernames_follows_a_group_crown_and_everyone(tmp_path):
    async def scenario():
        engine, maker = await _seeded(tmp_path)
        async with maker() as db:
            everyone = (
                await db.exec(select(Group.id).where(Group.system.is_(True)))
            ).first()
            crowned = Session(
                id=3, engine_id=1, resolver_id=1, requester_user_token="", requester_group_id=10
            )
            db.add(crowned)
            db.add(
                ResourceAccess(
                    resource_type=ResourceType.SESSION,
                    resource_id=2,
                    group_id=everyone,
                    capability=Capability.VIEW,
                )
            )
            await db.commit()
            by_group = await viewer_usernames(db, ResourceType.SESSION, 3)
            all_users = await viewer_usernames(db, ResourceType.SESSION, 2)
        await engine.dispose()
        return by_group, all_users

    by_group, all_users = asyncio.run(scenario())

    assert by_group == frozenset({"carol"})
    assert all_users == frozenset((*VIEWERS, OUTSIDER))


def test_a_frame_reaches_only_its_viewers(tmp_path):
    async def scenario():
        engine, _ = await _seeded(tmp_path)
        sockets = {name: _client(name) for name in (*VIEWERS, OUTSIDER)}
        admin, admin_socket = _client("root", admin=True)
        clients = [ctx for ctx, _ in sockets.values()] + [admin]
        await _dispatch("session.updated", {"id": 1}, clients)
        await _dispatch("session.1.telemetry", {}, clients)
        await _dispatch("session.15.telemetry", {}, clients)
        await _dispatch("proc.engine.telemetry", {}, clients)
        await engine.dispose()
        return {name: len(socket.sent) for name, (_, socket) in sockets.items()} | {
            "root": len(admin_socket.sent)
        }

    assert asyncio.run(scenario()) == {
        "alice": 2,
        "bob": 2,
        "carol": 2,
        "dave": 2,
        "erin": 2,
        "frank": 0,
        "root": 2,
    }


def test_a_deleted_row_only_reaches_the_admin(tmp_path):
    async def scenario():
        engine, maker = await _seeded(tmp_path)
        async with maker() as db:
            await db.delete(await db.get(Session, 2))
            await db.commit()
        alice, alice_socket = _client("alice")
        admin, admin_socket = _client("root", admin=True)
        await _dispatch("session.deleted", {"id": 2}, [alice, admin])
        await engine.dispose()
        return len(alice_socket.sent), len(admin_socket.sent)

    assert asyncio.run(scenario()) == (0, 1)


def test_the_bell_relay_ignores_live_samples(tmp_path):
    async def scenario():
        engine, _ = await _seeded(tmp_path)
        alice, socket = _client("alice")
        await _dispatch(
            "session.1.telemetry", {}, [alice], relay=ws._notifications_relay
        )
        await _dispatch(
            "session.started", {"id": 1}, [alice], relay=ws._notifications_relay
        )
        await engine.dispose()
        return [json.loads(frame)["data"]["event_type"] for frame in socket.sent]

    assert asyncio.run(scenario()) == ["session.started"]
