"""What keeps a capture nobody is watching from failing quietly.

A scheduled run has no operator in front of it: the disk fills, the channel
dies while its engine keeps running, or the row simply turns ``failed`` with
nobody told. Each guard here answers from evidence the run itself produces.
"""

from __future__ import annotations

import asyncio
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession as SQLModelAsyncSession

from mirrorr.di import container
from mirrorr.services import guards, webhook
from mirrorr.services.housekeeping import _epoch, prune_recordings, retention_doomed
from mirrorr.services.session_supervisor import SessionSupervisor
from mirrorr.startup.config import MirrorrSettings
from mirrorr.storage.models import Recording

_GB = 1024**3


# ── the content disk ─────────────────────────────────────────────────


def test_a_capture_is_not_refused_while_the_disk_guard_is_off(monkeypatch):
    monkeypatch.setattr(
        guards.shutil, "disk_usage", lambda _: (_ for _ in ()).throw(AssertionError("asked"))
    )
    assert guards.disk_refusal(Path("/nowhere"), 0) is None


def test_a_full_disk_is_refused_with_both_numbers(monkeypatch):
    monkeypatch.setattr(
        guards.shutil, "disk_usage", lambda _: SimpleNamespace(total=100 * _GB, used=99 * _GB, free=_GB // 2)
    )
    refusal = guards.disk_refusal(Path("/content"), 2)

    assert refusal is not None
    assert "0.5 GB free" in refusal
    assert "needs 2 GB" in refusal


def test_a_disk_with_room_is_allowed(monkeypatch):
    monkeypatch.setattr(
        guards.shutil, "disk_usage", lambda _: SimpleNamespace(total=100 * _GB, used=0, free=50 * _GB)
    )
    assert guards.disk_refusal(Path("/content"), 2) is None


def test_a_folder_that_does_not_exist_yet_is_not_a_disk_problem():
    assert guards.disk_refusal(Path("/definitely/not/here"), 2) is None


# ── the stream's own liveness ────────────────────────────────────────


def test_progress_moves_when_the_stream_writes_a_segment(tmp_path):
    segments = tmp_path / "segments"
    segments.mkdir()
    (tmp_path / "stream.m3u8").write_text("#EXTM3U\n")
    before = guards.progress(tmp_path)

    (segments / "stream-000000000001.ts").write_bytes(b"\x47" * 188)
    after = guards.progress(tmp_path)

    assert after != before
    assert after[1] == before[1] + 188


def test_a_frozen_stream_answers_the_same_progress_twice(tmp_path):
    segments = tmp_path / "segments"
    segments.mkdir()
    (tmp_path / "stream.m3u8").write_text("#EXTM3U\n#EXTINF:10,\nsegments/a.ts\n")
    (segments / "a.ts").write_bytes(b"x" * 400)

    assert guards.progress(tmp_path) == guards.progress(tmp_path)


def test_a_rewritten_playlist_counts_as_liveness(tmp_path):
    playlist = tmp_path / "stream.m3u8"
    playlist.write_text("#EXTM3U\n")
    before = guards.progress(tmp_path)

    playlist.write_text("#EXTM3U\n#EXTINF:10,\nsegments/a.ts\n")
    os.utime(playlist, (time.time() + 5, time.time() + 5))

    assert guards.progress(tmp_path) != before


def _watcher(tmp_path: Path, timeout: float) -> SessionSupervisor:
    supervisor = SessionSupervisor.__new__(SessionSupervisor)
    supervisor.settings = MirrorrSettings(
        base_dir=tmp_path, content_dir=tmp_path / "content", stall_timeout_s=timeout
    )
    supervisor.session_folder = tmp_path
    return supervisor


def test_a_frozen_stream_ends_the_attempt_with_a_reason(tmp_path, monkeypatch):
    monkeypatch.setattr("mirrorr.services.session_supervisor.STALL_POLL_S", 0.01)

    reason = asyncio.run(asyncio.wait_for(_watcher(tmp_path, 0.05)._watch_stall(), timeout=2))

    assert "no segment was written" in reason
    assert "the stream is gone" in reason


def test_a_stream_that_keeps_writing_is_not_stalled(tmp_path, monkeypatch):
    monkeypatch.setattr("mirrorr.services.session_supervisor.STALL_POLL_S", 0.01)
    segments = tmp_path / "segments"
    segments.mkdir()
    supervisor = _watcher(tmp_path, 0.2)

    async def scenario() -> str:
        watcher = asyncio.create_task(supervisor._watch_stall())
        for index in range(30):
            (segments / f"stream-{index:012d}.ts").write_bytes(b"\x47" * 188)
            await asyncio.sleep(0.02)
        watcher.cancel()
        try:
            return await watcher
        except asyncio.CancelledError:
            return "still running"

    assert asyncio.run(scenario()) == "still running"


def test_a_stall_watch_that_is_off_never_answers(tmp_path, monkeypatch):
    monkeypatch.setattr("mirrorr.services.session_supervisor.STALL_POLL_S", 0.01)
    supervisor = _watcher(tmp_path, 0)

    async def scenario() -> str:
        watcher = asyncio.create_task(supervisor._watch_stall())
        await asyncio.sleep(0.3)
        watcher.cancel()
        try:
            return await watcher
        except asyncio.CancelledError:
            return "still running"

    assert asyncio.run(scenario()) == "still running"


# ── retention ────────────────────────────────────────────────────────

_DAY = 86400.0


def _rows(*entries: tuple[int, float, int]) -> list[tuple[int, float, int]]:
    return list(entries)


def test_retention_does_nothing_while_both_caps_are_off():
    rows = _rows((1, 1_000_000.0, 10 * _GB))
    assert retention_doomed(rows, 0, 0, now=1_000_000.0) == []


def test_the_size_cap_dooms_the_oldest_first():
    now = 1_000_000.0
    rows = _rows((1, now - 3 * _DAY, 6 * _GB), (2, now - 2 * _DAY, 6 * _GB), (3, now - _DAY, 6 * _GB))

    assert retention_doomed(rows, 10, 0, now=now) == [1, 2]
    assert retention_doomed(rows, 15, 0, now=now) == [1]
    assert retention_doomed(rows, 20, 0, now=now) == []


def test_the_age_cap_dooms_by_age_whatever_the_size():
    now = 1_000_000.0
    rows = _rows((1, now - 30 * _DAY, 1), (2, now - 2 * _DAY, 1), (3, now - _DAY, 1))

    assert retention_doomed(rows, 0, 7, now=now) == [1]


def test_the_newest_recording_survives_a_cap_smaller_than_itself():
    now = 1_000_000.0
    rows = _rows((1, now - 2 * _DAY, 500 * _GB), (2, now - _DAY, 500 * _GB))

    doomed = retention_doomed(rows, 1, 0, now=now)

    assert doomed == [1]


def test_the_newest_recording_survives_the_age_cap_too():
    now = 1_000_000.0
    rows = _rows((7, now - 400 * _DAY, 10))

    assert retention_doomed(rows, 0, 1, now=now) == []


def test_a_naive_timestamp_is_read_as_utc():
    assert _epoch(datetime(2026, 10, 27, 12, 0, 0)) == datetime(
        2026, 10, 27, 12, 0, 0, tzinfo=timezone.utc
    ).timestamp()


def _recording(folder: Path, recording_id: int, created_at: datetime, size: int) -> Recording:
    return Recording(
        id=recording_id,
        user_friendly_name=f"gp{recording_id}",
        snake_case_name=f"gp{recording_id}",
        disk_path=str(folder),
        content_url=f"/content/recordings/gp{recording_id}/gp.mp4",
        profile_name="F1",
        engine_name="yt_dlp_piped",
        resolver_name="daddylive",
        session_id=None,
        started_at=created_at,
        ended_at=created_at,
        duration_seconds=60.0,
        size_bytes=size,
        created_at=created_at,
    )


def _folder(tmp_path: Path, name: str) -> Path:
    folder = tmp_path / "content" / "recordings" / name
    (folder / "logs").mkdir(parents=True, exist_ok=True)
    (folder / f"{name}.mp4").write_bytes(b"mp4")
    return folder


def _prune(tmp_path: Path, seed, **caps) -> list[str]:
    async def scenario() -> list[str]:
        engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'test.db'}")
        maker = async_sessionmaker(engine, class_=SQLModelAsyncSession, expire_on_commit=False)
        async with engine.begin() as conn:
            await conn.run_sync(SQLModel.metadata.create_all)
        async with maker() as db:
            seed(db)
            await db.commit()

        settings = MirrorrSettings(
            base_dir=tmp_path,
            content_dir=tmp_path / "content",
            retention_max_gb=caps.get("max_gb", 0),
            retention_max_age_days=caps.get("max_age", 0),
        )
        container.configure(settings=settings, db_factory=maker, event_bus=AsyncMock())
        try:
            return await prune_recordings(settings, maker, now=caps.get("now"))
        finally:
            container.reset()
            await engine.dispose()

    return asyncio.run(scenario())


def test_a_pruned_recording_loses_its_row_and_its_folder(tmp_path):
    half = _GB // 2
    now = time.time()
    old, newer, newest = (_folder(tmp_path, n) for n in ("gp1", "gp2", "gp3"))

    def seed(db):
        for index, folder in enumerate((old, newer, newest), start=1):
            db.add(_recording(folder, index, datetime.now(timezone.utc) - timedelta(days=4 - index), half))

    removed = _prune(tmp_path, seed, max_gb=1, now=now)

    assert removed == ["gp1"]
    assert not old.exists()
    assert newer.is_dir() and newest.is_dir()


def test_retention_leaves_the_newest_recording_in_place(tmp_path):
    newest = _folder(tmp_path, "only")

    removed = _prune(
        tmp_path,
        lambda db: db.add(_recording(newest, 1, datetime.now(timezone.utc) - timedelta(days=90), 900 * _GB)),
        max_gb=1,
        now=time.time(),
    )

    assert removed == []
    assert newest.is_dir()


def test_a_retention_sweep_with_no_caps_touches_nothing(tmp_path):
    folder = _folder(tmp_path, "gp1")

    assert _prune(tmp_path, lambda db: db.add(_recording(folder, 1, datetime.now(timezone.utc), 1)), now=time.time()) == []
    assert folder.is_dir()


# ── the webhook ──────────────────────────────────────────────────────


class _Response:
    def __init__(self, status_code: int) -> None:
        self.status_code = status_code


def _settings(tmp_path: Path, url: str) -> MirrorrSettings:
    return MirrorrSettings(base_dir=tmp_path, content_dir=tmp_path / "content", alert_webhook_url=url)


def test_no_webhook_configured_sends_nothing(tmp_path, monkeypatch):
    class _Client:
        def __init__(self, **_):
            raise AssertionError("a client was built with no webhook configured")

    monkeypatch.setattr(webhook.httpx, "AsyncClient", _Client)
    asyncio.run(webhook.send_alert(_settings(tmp_path, ""), "session.failed", "boom"))


def test_an_alert_posts_one_json_object_with_its_fields(tmp_path, monkeypatch):
    calls: list[tuple[str, dict]] = []

    class _Client:
        def __init__(self, **_):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return False

        async def post(self, url, json):
            calls.append((url, json))
            return _Response(200)

    monkeypatch.setattr(webhook.httpx, "AsyncClient", _Client)
    asyncio.run(
        webhook.send_alert(
            _settings(tmp_path, "https://hook.example/x"),
            "session.failed",
            "Session 9 failed",
            "no segment was written for 120s",
            session_id=9,
            autorun_id=3,
            url="https://console/sessions/9",
        )
    )

    assert len(calls) == 1
    url, payload = calls[0]
    assert url == "https://hook.example/x"
    assert payload == {
        "event": "session.failed",
        "title": "Session 9 failed",
        "body": "no segment was written for 120s",
        "session_id": 9,
        "autorun_id": 3,
        "url": "https://console/sessions/9",
    }


def test_a_failing_webhook_never_raises(tmp_path, monkeypatch):
    class _Client:
        def __init__(self, **_):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return False

        async def post(self, url, json):
            raise httpx.ConnectError("no route")

    monkeypatch.setattr(webhook.httpx, "AsyncClient", _Client)
    asyncio.run(webhook.send_alert(_settings(tmp_path, "https://hook.example/x"), "session.failed", "boom"))


def test_a_webhook_answering_an_error_is_only_a_warning(tmp_path, monkeypatch):
    class _Client:
        def __init__(self, **_):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return False

        async def post(self, url, json):
            return _Response(500)

    monkeypatch.setattr(webhook.httpx, "AsyncClient", _Client)
    asyncio.run(webhook.send_alert(_settings(tmp_path, "https://hook.example/x"), "session.failed", "boom"))


def test_the_guards_are_on_by_default_and_deleting_is_not():
    settings = MirrorrSettings()

    assert settings.min_free_gb == 2.0
    assert settings.stall_timeout_s == 120.0
    assert settings.retention_max_gb == 0
    assert settings.retention_max_age_days == 0
    assert settings.alert_webhook_url == ""
