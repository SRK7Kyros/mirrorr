"""Where a session writes, and who may write there.

An autorun's fallback captures a different source, so each capture needs its own
folder — and a folder already held by a live session is refused rather than
interleaving two segment sets in one playlist.
"""
from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession as SQLModelAsyncSession

from mirrorr.di import container
from mirrorr.services import session_supervisor
from mirrorr.services.session_lifecycle import live_folder_holder
from mirrorr.services.session_supervisor import SessionSupervisor
from mirrorr.startup.config import MirrorrSettings
from mirrorr.storage.enums import SessionStatus
from mirrorr.storage.models import Session


def _autorun_session() -> SimpleNamespace:
    return SimpleNamespace(
        id=5,
        is_autorun=True,
        autorun=SimpleNamespace(profile_id=1, snake_case_name="united_states_gp_fp2"),
        autorun_id=1,
        profile=SimpleNamespace(id=1, name="F1"),
        profile_id=1,
        engine=SimpleNamespace(name="yt-dlp piped"),
        recording=False,
        resolver=SimpleNamespace(name="tvnow247", origin="tvnow247", origin_hash="h"),
        resolver_config={"channel": "577"},
        retry_mode="none",
        retry_config={},
        retry_attempts=0,
        attempts=[],
        captures=[],
        capture_plan=[1, 2],
    )


def _supervisor(tmp_path, settings=None) -> SessionSupervisor:
    settings = settings or MirrorrSettings(base_dir=tmp_path)
    return SessionSupervisor(5, _autorun_session(), SimpleNamespace(), SimpleNamespace(), settings)


def test_each_capture_writes_into_its_own_folder(tmp_path):
    settings = MirrorrSettings(base_dir=tmp_path)
    sup = _supervisor(tmp_path, settings)
    primary = (settings.autoruns_dir / "united_states_gp_fp2").resolve()
    assert sup.session_folder == primary
    assert sup._primary_folder == primary

    capture_settings = {
        "profile_id": 2,
        "profile_name": "F1 UK",
        "engine_name": "yt-dlp piped",
        "resolver_name": "tvnow247",
        "resolver_origin": "tvnow247",
        "resolver_hash": "h",
        "resolver_config": {"channel": "60"},
        "retry_mode": "none",
        "retry_config": {},
    }
    with patch.object(
        session_supervisor,
        "load_capture",
        AsyncMock(return_value=(capture_settings, SimpleNamespace(), SimpleNamespace())),
    ) as loader:
        assert asyncio.run(sup._begin_capture(2, 2)) is None

    # A plan entry stored before rungs existed is completed from the profile it
    # names; the loader only ever sees a concrete spec.
    spec = loader.await_args.args[1]
    assert (spec["source"], spec["profile_id"]) == ("profile", 2)

    assert sup.session_folder == primary.parent / f"{primary.name}_capture2"
    assert sup.segments_folder.parent == sup.session_folder
    assert sup._capture_settings["profile_name"] == "F1 UK"


def test_live_folder_holder_names_the_other_live_session(tmp_path):
    async def scenario():
        engine = create_async_engine("sqlite+aiosqlite://")
        async with engine.begin() as conn:
            await conn.run_sync(SQLModel.metadata.create_all)
        maker = async_sessionmaker(engine, class_=SQLModelAsyncSession, expire_on_commit=False)
        settings = MirrorrSettings(base_dir=tmp_path)
        container.configure(settings=settings, db_factory=maker, event_bus=AsyncMock())
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
