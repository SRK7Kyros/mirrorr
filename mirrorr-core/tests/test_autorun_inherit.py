import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import SQLModel, select
from sqlmodel.ext.asyncio.session import AsyncSession as SQLModelAsyncSession

from mirrorr.services import autorun_scheduler
from mirrorr.services.autorun_scheduler import _tick
from mirrorr.startup.config import MirrorrSettings
from mirrorr.storage.enums import AutorunStatus, Capability, ResourceType
from mirrorr.storage.models import Autorun, ResourceAccess, ResourceOwnerGroup, Session


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
    await db.commit()


def test_spawned_session_inherits_the_autoruns_grants_and_owner_groups(monkeypatch, tmp_path):
    async def scenario() -> None:
        engine = create_async_engine("sqlite+aiosqlite://")
        async with engine.begin() as conn:
            await conn.run_sync(SQLModel.metadata.create_all)
        maker = async_sessionmaker(engine, class_=SQLModelAsyncSession, expire_on_commit=False)
        monkeypatch.setattr(autorun_scheduler, "bus", _Bus())

        async with maker() as db:
            await _seed(db)

        await _tick(maker, MirrorrSettings(base_dir=tmp_path))

        async with maker() as db:
            session = (await db.exec(select(Session))).first()
            assert session is not None
            assert session.autorun_id == 1
            assert session.requester_user_token == "kyros"

            grants = (
                await db.exec(
                    select(ResourceAccess).where(
                        ResourceAccess.resource_type == ResourceType.SESSION
                    )
                )
            ).all()
            assert {(g.username, g.group_id, g.capability) for g in grants} == {
                ("alice", None, Capability.VIEW),
                ("alice", None, Capability.OPERATE),
                (None, 9, Capability.EDIT),
            }
            owners = (
                await db.exec(
                    select(ResourceOwnerGroup).where(
                        ResourceOwnerGroup.resource_type == ResourceType.SESSION
                    )
                )
            ).all()
            assert [o.group_id for o in owners] == [9]

            autorun_grants = (
                await db.exec(
                    select(ResourceAccess).where(
                        ResourceAccess.resource_type == ResourceType.AUTORUN
                    )
                )
            ).all()
            assert len(autorun_grants) == 3

        await engine.dispose()

    asyncio.run(scenario())
