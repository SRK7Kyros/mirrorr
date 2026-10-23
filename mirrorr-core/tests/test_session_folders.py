"""Where a session writes, and who may write there.

An autorun's fallback rung captures a different source, so each rung needs its
own folder — and a folder already held by a live session is refused rather than
interleaving two segment sets in one playlist.
"""
from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession as SQLModelAsyncSession

from mirrorr.di import container
from mirrorr.services.session_lifecycle import live_folder_holder
from mirrorr.services.session_supervisor import SessionSupervisor
from mirrorr.startup.config import MirrorrSettings
from mirrorr.storage.enums import SessionStatus
from mirrorr.storage.models import Session


def _autorun_session(profile_id: int, profile_name: str) -> SimpleNamespace:
    return SimpleNamespace(
        id=5,
        is_autorun=True,
        autorun=SimpleNamespace(profile_id=1, snake_case_name="united_states_gp_fp2"),
        autorun_id=1,
        profile=SimpleNamespace(id=profile_id, name=profile_name),
        recording=False,
    )


def _folder(tmp_path, session: SimpleNamespace, settings=None) -> Path:
    settings = settings or MirrorrSettings(base_dir=tmp_path)
    sup = SessionSupervisor(5, session, SimpleNamespace(), SimpleNamespace(), settings)
    return sup.session_folder


def test_a_fallback_rung_captures_into_its_own_folder(tmp_path):
    settings = MirrorrSettings(base_dir=tmp_path)

    primary = _folder(tmp_path, _autorun_session(1, "F1"), settings)
    rung = _folder(tmp_path, _autorun_session(2, "F1 UK"), settings)

    assert primary == (settings.autoruns_dir / "united_states_gp_fp2").resolve()
    assert rung == (settings.autoruns_dir / "united_states_gp_fp2_F1 UK").resolve()


def test_live_folder_holder_names_the_other_live_session(tmp_path):
    async def scenario():
        engine = create_async_engine("sqlite+aiosqlite://")
        async with engine.begin() as conn:
            await conn.run_sync(SQLModel.metadata.create_all)
        maker = async_sessionmaker(engine, class_=SQLModelAsyncSession, expire_on_commit=False)
        settings = MirrorrSettings(base_dir=tmp_path)
        container.configure(settings=settings, session_factory=maker, event_bus=AsyncMock())
        try:
            async with maker() as db:
                for sid, status in (
                    (1, SessionStatus.RECORDING),
                    (2, SessionStatus.FAILED),
                    (3, SessionStatus.INITIALIZING),
                ):
                    db.add(
                        Session(
                            id=sid,
                            engine_id=1,
                            resolver_id=1,
                            requester_user_token="kyros",
                            session_folder="/content/x",
                            status=status,
                        )
                    )
                await db.commit()

            # a live holder is named; a finished one is not; the caller never is
            assert await live_folder_holder(settings, Path("/content/x"), 3) == 1
            assert await live_folder_holder(settings, Path("/content/x"), 1) == 3
            assert await live_folder_holder(settings, Path("/content/other"), 1) is None
        finally:
            container.reset()
        await engine.dispose()

    asyncio.run(scenario())
