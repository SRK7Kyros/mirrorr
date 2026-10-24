"""A deleted recording must not leave its media behind.

``DELETE /recordings/{id}`` is documented as "removes file+row" and the console
tells the user "The file is removed from disk", but the router only removed the
row: every deleted recording left its folder — the mp4, the player shells and
the logs — on disk for ever, and no screen lists it any more.
``session_lifecycle.remove_recording_folder()`` is that one place now, with the
same guards as the session sibling.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock

from fastapi import Request
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession as SQLModelAsyncSession

from mirrorr.api.api import API
from mirrorr.api.dependencies import AuthState, _get_db, get_auth
from mirrorr.di import container
from mirrorr.startup.config import MirrorrSettings
from mirrorr.storage.enums import UserRole
from mirrorr.storage.models import Recording, User


def _recording(folder: str, id: int = 1) -> Recording:
    now = datetime.now(timezone.utc)
    return Recording(
        id=id,
        user_friendly_name="f1",
        snake_case_name="f1",
        disk_path=folder,
        content_url="/content/recordings/f1/f1.mp4",
        profile_name="F1",
        engine_name="yt_dlp_piped",
        resolver_name="static",
        session_id=None,
        started_at=now,
        ended_at=now,
        duration_seconds=60.0,
        size_bytes=12,
    )


def _folder(tmp_path: Path, *parts: str) -> Path:
    folder = tmp_path.joinpath("content", *parts)
    (folder / "logs").mkdir(parents=True, exist_ok=True)
    (folder / f"{folder.name}.mp4").write_bytes(b"mp4")
    (folder / "logs" / "ffmpeg.stderr.log").write_text("x")
    return folder


def _delete(tmp_path: Path, seed, recording_id: int) -> int:
    """DELETE /recordings/<id> against a file-backed DB and a container on tmp_path.

    The DB is a file, not ``:memory:``, because the removal opens its own
    connection through the container's factory to read the kept rows.
    """

    async def scenario() -> int:
        engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'test.db'}")
        maker = async_sessionmaker(engine, class_=SQLModelAsyncSession, expire_on_commit=False)
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

        async def _db():
            async with maker() as db:
                yield db

        def _auth(request: Request):
            request.state.is_admin = True
            return AuthState(
                client=None,
                user=User(id=1, username="admin", role=UserRole.ADMIN),
                is_admin=True,
            )

        API.dependency_overrides[_get_db] = _db
        API.dependency_overrides[get_auth] = _auth
        try:
            transport = ASGITransport(app=API)
            async with AsyncClient(transport=transport, base_url="http://t") as client:
                return (await client.delete(f"/recordings/{recording_id}")).status_code
        finally:
            API.dependency_overrides.clear()
            container.reset()
            await engine.dispose()

    return asyncio.run(scenario())


def test_deleting_a_recording_removes_its_folder_and_file(tmp_path):
    folder = _folder(tmp_path, "recordings", "f1")

    status = _delete(tmp_path, lambda db: db.add(_recording(str(folder))), 1)

    assert status < 300
    assert not folder.exists()


def test_a_folder_another_kept_recording_still_names_is_left_alone(tmp_path):
    folder = _folder(tmp_path, "recordings", "f1")

    def seed(db):
        db.add(_recording(str(folder), id=1))
        db.add(_recording(str(folder), id=2))

    assert _delete(tmp_path, seed, 1) < 300
    assert (folder / "f1.mp4").exists()


def test_a_folder_outside_the_content_dir_is_never_removed(tmp_path):
    outside = tmp_path / "elsewhere"
    outside.mkdir()
    (outside / "f1.mp4").write_bytes(b"mp4")

    assert _delete(tmp_path, lambda db: db.add(_recording(str(outside))), 1) < 300
    assert (outside / "f1.mp4").exists()


def test_the_reserved_recordings_root_itself_is_never_removed(tmp_path):
    root = _folder(tmp_path, "recordings")

    assert _delete(tmp_path, lambda db: db.add(_recording(str(root))), 1) < 300
    assert (root / "recordings.mp4").exists()
