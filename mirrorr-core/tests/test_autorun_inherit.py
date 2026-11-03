import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import SQLModel, select
from sqlmodel.ext.asyncio.session import AsyncSession as SQLModelAsyncSession

from mirrorr.api.dependencies import AuthState
from mirrorr.services import autorun_scheduler
from mirrorr.services.autorun_scheduler import _tick
from mirrorr.services.permissions import (
    access_predicate,
    has_capability,
    inherit_effective_access,
)
from mirrorr.startup.config import MirrorrSettings
from mirrorr.storage.enums import AutorunStatus, Capability, ResourceType, UserRole
from mirrorr.storage.models import (
    EVERYONE_GROUP_NAME,
    Autorun,
    EventSubscription,
    Group,
    GroupMember,
    Recording,
    ResourceAccess,
    ResourceOwnerGroup,
    ResourceOwnerUser,
    Session,
    User,
)


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class _Bus:
    def __init__(self) -> None:
        self.events: list = []

    async def emit(self, event) -> None:
        self.events.append(event)


async def _seed(db) -> None:
    db.add(
        Autorun(
            id=1,
            user_friendly_name="F1 Race",
            snake_case_name="f1-race",
            engine_id=1,
            resolver_id=1,
            status=AutorunStatus.SCHEDULED,
            start_time=_now() - timedelta(minutes=1),
            end_time=_now() + timedelta(hours=1),
            requester_user_token="kyros",
        )
    )
    db.add(ResourceAccess(resource_type=ResourceType.AUTORUN, resource_id=1, username="alice", capability=Capability.VIEW))
    db.add(ResourceAccess(resource_type=ResourceType.AUTORUN, resource_id=1, username="alice", capability=Capability.OPERATE))
    db.add(ResourceAccess(resource_type=ResourceType.AUTORUN, resource_id=1, group_id=9, capability=Capability.EDIT))
    db.add(ResourceOwnerGroup(resource_type=ResourceType.AUTORUN, resource_id=1, group_id=9))
    db.add(ResourceOwnerUser(resource_type=ResourceType.AUTORUN, resource_id=1, username="dana"))
    await db.commit()


def test_a_spawned_session_copies_nothing_and_answers_to_its_autorun(monkeypatch, tmp_path):
    async def scenario() -> None:
        engine = create_async_engine("sqlite+aiosqlite://")
        async with engine.begin() as conn:
            await conn.run_sync(SQLModel.metadata.create_all)
        maker = async_sessionmaker(engine, class_=SQLModelAsyncSession, expire_on_commit=False)
        monkeypatch.setattr(autorun_scheduler, "bus", _Bus())

        async with maker() as db:
            await _seed_audience(db)

        await _tick(maker, MirrorrSettings(base_dir=tmp_path))

        async with maker() as db:
            session = (await db.exec(select(Session))).first()
            assert session is not None
            assert session.autorun_id == 1
            assert session.requester_user_token == "kyros"
            for model in (ResourceAccess, ResourceOwnerGroup, ResourceOwnerUser):
                rows = (
                    await db.exec(
                        select(model).where(
                            model.resource_type == ResourceType.SESSION
                        )
                    )
                ).all()
                assert rows == [], model.__name__

            assert await has_capability(db, _auth("kyros"), session, Capability.DELETE)
            assert await has_capability(db, _auth("alice"), session, Capability.OPERATE)
            assert await has_capability(db, _auth("bob"), session, Capability.EDIT)
            assert await has_capability(db, _auth("dana"), session, Capability.DELETE)
            assert await has_capability(db, _auth("eve"), session, Capability.VIEW)
            assert not await has_capability(db, _auth("eve"), session, Capability.EDIT)

        await engine.dispose()

    asyncio.run(scenario())


def test_editing_the_autoruns_sharing_moves_its_existing_sessions(monkeypatch, tmp_path):
    """The link is live, not a snapshot: a revoke on the schedule takes the run
    away, and a grant added afterwards reaches the run already produced."""

    async def scenario() -> None:
        engine = create_async_engine("sqlite+aiosqlite://")
        async with engine.begin() as conn:
            await conn.run_sync(SQLModel.metadata.create_all)
        maker = async_sessionmaker(engine, class_=SQLModelAsyncSession, expire_on_commit=False)
        monkeypatch.setattr(autorun_scheduler, "bus", _Bus())

        async with maker() as db:
            await _seed_audience(db)

        await _tick(maker, MirrorrSettings(base_dir=tmp_path))

        async with maker() as db:
            session = (await db.exec(select(Session))).first()
            assert session is not None
            assert await has_capability(db, _auth("alice"), session, Capability.OPERATE)
            assert not await has_capability(db, _auth("eve"), session, Capability.EDIT)

            for row in (
                await db.exec(
                    select(ResourceAccess).where(
                        ResourceAccess.resource_type == ResourceType.AUTORUN,
                        ResourceAccess.resource_id == 1,
                        ResourceAccess.username == "alice",
                    )
                )
            ).all():
                await db.delete(row)
            db.add(
                ResourceAccess(
                    resource_type=ResourceType.AUTORUN,
                    resource_id=1,
                    username="eve",
                    capability=Capability.OPERATE,
                )
            )
            await db.commit()

        async with maker() as db:
            session = (await db.exec(select(Session))).first()
            assert session is not None
            assert not await has_capability(db, _auth("alice"), session, Capability.OPERATE)
            assert await has_capability(db, _auth("eve"), session, Capability.OPERATE)

        await engine.dispose()

    asyncio.run(scenario())


def test_spawn_survives_the_requester_subscription_insert(monkeypatch, tmp_path):
    """A real requester user makes subscribe_requester write, which used to
    commit the tick's transaction from inside its savepoint and strand the
    session row with no supervisor (the Oct 23 2026 autorun failure)."""

    async def scenario() -> None:
        engine = create_async_engine("sqlite+aiosqlite://")
        async with engine.begin() as conn:
            await conn.run_sync(SQLModel.metadata.create_all)
        maker = async_sessionmaker(engine, class_=SQLModelAsyncSession, expire_on_commit=False)
        monkeypatch.setattr(autorun_scheduler, "bus", _Bus())

        async with maker() as db:
            db.add(User(id=1, username="kyros"))
            await _seed(db)

        await _tick(maker, MirrorrSettings(base_dir=tmp_path))

        async with maker() as db:
            session = (await db.exec(select(Session))).first()
            assert session is not None
            subs = (await db.exec(select(EventSubscription))).all()
            assert [(s.user_id, s.resource_type, s.resource_id) for s in subs] == [
                (1, ResourceType.SESSION, session.id)
            ]
            copies = (
                await db.exec(
                    select(ResourceAccess).where(
                        ResourceAccess.resource_type == ResourceType.SESSION
                    )
                )
            ).all()
            assert copies == []

        await engine.dispose()

    asyncio.run(scenario())


def _auth(username: str | None, admin: bool = False) -> AuthState:
    user = (
        None
        if username is None
        else User(
            id=1, username=username, role=UserRole.ADMIN if admin else UserRole.USER
        )
    )
    return AuthState(client=None, user=user, is_admin=admin)


def _autorun(row_id: int, name: str, minutes_ago: int, **owner) -> Autorun:
    return Autorun(
        id=row_id,
        user_friendly_name=name,
        snake_case_name=name.lower().replace(" ", "-"),
        engine_id=1,
        resolver_id=1,
        status=AutorunStatus.SCHEDULED,
        start_time=_now() - timedelta(minutes=minutes_ago),
        end_time=_now() + timedelta(hours=1),
        **owner,
    )


def _grant(
    resource_id: int,
    capability: Capability,
    *,
    username: str | None = None,
    group_id: int | None = None,
) -> ResourceAccess:
    return ResourceAccess(
        resource_type=ResourceType.AUTORUN,
        resource_id=resource_id,
        username=username,
        group_id=group_id,
        capability=capability,
    )


async def _seed_audience(db) -> None:
    """Two autoruns — one with a user owner, one with a group owner — plus the
    people who could hold a permission on either: a direct grant, a group grant
    (as a member), the sealed ``everyone`` group, an additive owner user, and
    someone holding nothing at all."""
    db.add_all(
        User(id=i, username=name, role=UserRole.USER)
        for i, name in enumerate(["kyros", "alice", "bob", "dana", "eve"], start=1)
    )
    db.add_all(
        [
            Group(id=7, name=EVERYONE_GROUP_NAME, display_name="Everyone", system=True),
            Group(id=9, name="f1-crew", display_name="F1 crew"),
            GroupMember(group_id=9, username="bob"),
            _autorun(1, "F1 Race", 2, requester_user_token="kyros"),
            _autorun(2, "F1 Sprint", 1, requester_user_token="", requester_group_id=9),
            _grant(1, Capability.VIEW, username="alice"),
            _grant(1, Capability.OPERATE, username="alice"),
            _grant(1, Capability.EDIT, group_id=9),
            _grant(1, Capability.EXPORT, group_id=7),
            ResourceOwnerGroup(
                resource_type=ResourceType.AUTORUN, resource_id=1, group_id=9
            ),
            ResourceOwnerUser(
                resource_type=ResourceType.AUTORUN, resource_id=1, username="dana"
            ),
            _grant(2, Capability.VIEW, username="alice"),
        ]
    )
    await db.commit()


def test_the_sessions_list_applies_the_same_live_rule(monkeypatch, tmp_path):
    """The paginated list is a second implementation of the predicate; it must
    admit exactly whose runs the live link admits, and follow a later revoke."""

    async def scenario() -> None:
        engine = create_async_engine("sqlite+aiosqlite://")
        async with engine.begin() as conn:
            await conn.run_sync(SQLModel.metadata.create_all)
        maker = async_sessionmaker(engine, class_=SQLModelAsyncSession, expire_on_commit=False)
        monkeypatch.setattr(autorun_scheduler, "bus", _Bus())

        async with maker() as db:
            await _seed_audience(db)

        await _tick(maker, MirrorrSettings(base_dir=tmp_path))

        async with maker() as db:
            async def seen(username: str) -> list[int]:
                rows = (
                    await db.exec(
                        select(Session).where(access_predicate(Session, username))
                    )
                ).all()
                return sorted(session.autorun_id for session in rows)

            assert await seen("alice") == [1, 2]
            assert await seen("kyros") == [1]
            assert await seen("bob") == [1, 2]
            assert await seen("dana") == [1]
            assert await seen("eve") == [1]
            assert await seen("ghost") == [1]

            everyone_grant = (
                await db.exec(
                    select(ResourceAccess).where(
                        ResourceAccess.resource_type == ResourceType.AUTORUN,
                        ResourceAccess.resource_id == 1,
                        ResourceAccess.group_id == 7,
                    )
                )
            ).first()
            assert everyone_grant is not None
            await db.delete(everyone_grant)
            await db.commit()

            assert await seen("eve") == []

        await engine.dispose()

    asyncio.run(scenario())


def test_a_recording_keeps_what_its_session_could_see():
    async def scenario() -> None:
        engine = create_async_engine("sqlite+aiosqlite://")
        async with engine.begin() as conn:
            await conn.run_sync(SQLModel.metadata.create_all)
        maker = async_sessionmaker(engine, class_=SQLModelAsyncSession, expire_on_commit=False)

        async with maker() as db:
            await _seed_audience(db)
            db.add_all(
                [
                    Session(
                        id=1,
                        autorun_id=1,
                        engine_id=1,
                        resolver_id=1,
                        requester_user_token="kyros",
                    ),
                    Recording(
                        id=1,
                        user_friendly_name="F1 Race",
                        snake_case_name="f1-race",
                        disk_path="/tmp/f1-race",
                        content_url="http://mirrorr/content/recordings/f1-race.mp4",
                        profile_name="F1",
                        engine_name="yt_dlp_piped",
                        resolver_name="static",
                        started_at=_now(),
                        ended_at=_now(),
                        duration_seconds=1.0,
                        size_bytes=1,
                        requester_user_token="kyros",
                    ),
                ]
            )
            await db.commit()

            await inherit_effective_access(db, await db.get(Session, 1), await db.get(Recording, 1))
            await db.commit()

        async with maker() as db:
            recording = await db.get(Recording, 1)
            assert recording is not None
            for model, expected in (
                (ResourceAccess, 4),
                (ResourceOwnerGroup, 1),
                (ResourceOwnerUser, 1),
            ):
                rows = (
                    await db.exec(
                        select(model).where(
                            model.resource_type == ResourceType.RECORDING
                        )
                    )
                ).all()
                assert len(rows) == expected, model.__name__

            for username, held in (
                ("kyros", set(Capability)),
                ("bob", set(Capability)),
                ("dana", set(Capability)),
                ("alice", {Capability.VIEW, Capability.OPERATE, Capability.EXPORT}),
                ("eve", {Capability.VIEW, Capability.EXPORT}),
                ("ghost", {Capability.VIEW, Capability.EXPORT}),
            ):
                for capability in Capability:
                    assert (
                        await has_capability(db, _auth(username), recording, capability)
                    ) is (capability in held), (username, capability)

        await engine.dispose()

    asyncio.run(scenario())


def test_a_spawned_session_answers_every_capability_like_its_autorun(monkeypatch, tmp_path):
    """For every account and every one of the six capabilities,
    ``has_capability`` must answer on the session exactly what it answers on the
    autorun: the user crown, the group crown, direct and group grants, the sealed
    ``everyone`` group, additive owner rows, a stranger, an anonymous caller and
    an admin."""

    async def scenario() -> None:
        engine = create_async_engine("sqlite+aiosqlite://")
        async with engine.begin() as conn:
            await conn.run_sync(SQLModel.metadata.create_all)
        maker = async_sessionmaker(engine, class_=SQLModelAsyncSession, expire_on_commit=False)
        monkeypatch.setattr(autorun_scheduler, "bus", _Bus())

        async with maker() as db:
            await _seed_audience(db)

        await _tick(maker, MirrorrSettings(base_dir=tmp_path))

        principals = [
            ("kyros", False),
            ("alice", False),
            ("bob", False),
            ("dana", False),
            ("eve", False),
            (None, False),
            ("kyros", True),
        ]

        async with maker() as db:
            sessions = (await db.exec(select(Session))).all()
            assert sorted(s.autorun_id for s in sessions) == [1, 2]
            autoruns = {a.id: a for a in (await db.exec(select(Autorun))).all()}

            for session in sessions:
                autorun = autoruns[session.autorun_id]
                for username, admin in principals:
                    auth = _auth(username, admin)
                    for capability in Capability:
                        matches = await has_capability(
                            db, auth, session, capability
                        ) == await has_capability(db, auth, autorun, capability)
                        assert matches, (
                            f"session {session.id} of autorun {autorun.id} disagrees "
                            f"with it for {username or 'anonymous'} on {capability}"
                        )

        await engine.dispose()

    asyncio.run(scenario())
