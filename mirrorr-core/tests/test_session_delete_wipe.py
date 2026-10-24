"""A deleted session must not leave its content folder behind.

Nothing removed ``Session.session_folder`` on the API delete path, so a deleted
session's HLS tree stayed on disk until the hourly housekeeping sweep — and the
next session for the same profile had to take a new numbered folder (F1, F1_2,
…). ``session_lifecycle.remove_session_folder()`` is that one place now, for the
API deleter and for the supervisor's own finalize paths.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession as SQLModelAsyncSession

from mirrorr.di import container
from mirrorr.services.session_lifecycle import delete_session, remove_session_folder
from mirrorr.startup.config import MirrorrSettings
from mirrorr.storage import crud
from mirrorr.storage.enums import SessionStatus
from mirrorr.storage.models import Recording, Session


def _engine_and_maker():
    engine = create_async_engine("sqlite+aiosqlite://")
    maker = async_sessionmaker(engine, class_=SQLModelAsyncSession, expire_on_commit=False)
    return engine, maker


def _session(folder: str) -> Session:
    return Session(
        id=1,
        engine_id=1,
        resolver_id=1,
        status=SessionStatus.COMPLETED,
        requester_user_token="u",
        session_folder=folder,
    )


def _recording(disk_path: str) -> Recording:
    now = datetime.now(timezone.utc)
    return Recording(
        id=1,
        user_friendly_name="f1",
        snake_case_name="f1",
        disk_path=disk_path,
        content_url="/content/recordings/f1/f1.mp4",
        profile_name="F1",
        engine_name="yt_dlp_piped",
        resolver_name="static",
        session_id=1,
        started_at=now,
        ended_at=now,
        duration_seconds=60.0,
        size_bytes=1024,
    )


def _folder(tmp_path: Path, *parts: str) -> Path:
    folder = tmp_path.joinpath("content", *parts)
    (folder / "segments").mkdir(parents=True, exist_ok=True)
    (folder / "segments" / "stream-000000000000.ts").write_bytes(b"ts")
    (folder / "stream.m3u8").write_text("#EXTM3U\n")
    return folder


def _scenario(tmp_path: Path, seed, work):
    """Run *work* against an in-memory DB and a container wired to *tmp_path*."""

    async def scenario():
        engine, maker = _engine_and_maker()
        async with engine.begin() as conn:
            await conn.run_sync(SQLModel.metadata.create_all)
        async with maker() as db:
            seed(db)
            await db.commit()

        container.configure(
            settings=MirrorrSettings(base_dir=tmp_path, content_dir=tmp_path / "content"),
            db_factory=maker,
            event_bus=AsyncMock(),
        )
        try:
            return await work()
        finally:
            container.reset()
            await engine.dispose()

    return asyncio.run(scenario())


def test_deleting_a_session_removes_its_folder(tmp_path):
    folder = _folder(tmp_path, "F1_6")

    async def work():
        await delete_session(container.settings, 1, folder, nc=AsyncMock())
        async with container.db_factory() as db:
            return await crud.get_by_id(db, Session, 1)

    assert _scenario(tmp_path, lambda db: db.add(_session(str(folder))), work) is None
    assert not folder.exists()


def test_a_folder_a_kept_recording_lives_in_is_never_removed(tmp_path):
    folder = _folder(tmp_path, "recordings", "f1")

    def seed(db):
        db.add(_session(str(folder)))
        db.add(_recording(str(folder)))

    async def work():
        await remove_session_folder(container.settings, folder)

    _scenario(tmp_path, seed, work)

    assert (folder / "stream.m3u8").exists()


def test_the_reserved_roots_themselves_are_never_removed(tmp_path):
    recordings = _folder(tmp_path, "recordings")
    autoruns = _folder(tmp_path, "autoruns")

    async def work():
        await remove_session_folder(container.settings, recordings)
        await remove_session_folder(container.settings, autoruns)

    _scenario(tmp_path, lambda db: None, work)

    assert (recordings / "stream.m3u8").exists()
    assert (autoruns / "stream.m3u8").exists()


def test_a_folder_outside_the_content_dir_is_never_removed(tmp_path):
    outside = tmp_path / "elsewhere"
    outside.mkdir()
    (outside / "stream.m3u8").write_text("#EXTM3U\n")

    async def work():
        await remove_session_folder(container.settings, outside)
        await remove_session_folder(container.settings, tmp_path / "content")

    _scenario(tmp_path, lambda db: None, work)

    assert (outside / "stream.m3u8").exists()
