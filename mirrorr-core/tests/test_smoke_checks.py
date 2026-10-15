"""The two-stage startup gate: initializing → stream_pending → active/failed.

Covers the resolver smoke_test hook, the m3u8 readiness poll, and the failure
semantics (row kept + reason recorded, uniform retry).
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession as SQLModelAsyncSession

from mirrorr.di import container
from mirrorr.plugin_api.interfaces import ResolverInterface, Source
from mirrorr.services import session_supervisor
from mirrorr.services.process_bus import EngineDone
from mirrorr.services.session_lifecycle import update_session
from mirrorr.services.session_supervisor import SessionSupervisor
from mirrorr.startup.config import MirrorrSettings
from mirrorr.storage import crud
from mirrorr.storage.enums import SessionStatus
from mirrorr.storage.models import Session


def _session(recording: bool = False) -> SimpleNamespace:
    return SimpleNamespace(
        id=1,
        is_autorun=False,
        autorun=None,
        autorun_id=None,
        profile=None,
        recording=recording,
        resolver=SimpleNamespace(origin="static", origin_hash="h"),
        resolver_config={},
        retry_mode="none",
        retry_config={},
        retry_attempts=0,
        attempts=[],
    )


def _resolver(resolve=None, smoke_test=None) -> SimpleNamespace:
    async def _resolve(config, ctx):
        return Source(url="http://example/stream")

    return SimpleNamespace(
        resolve=resolve or _resolve,
        smoke_test=smoke_test if smoke_test is not None else AsyncMock(),
        stop=AsyncMock(),
    )


def _engine(*, playlist_after=None, done_after=None, on_start=None) -> SimpleNamespace:
    async def _start(ctx, source):
        async def _script():
            if on_start is not None:
                await on_start(ctx)
            if playlist_after is not None:
                await asyncio.sleep(playlist_after)
                (ctx.session_folder / "stream.m3u8").write_text("x")
            if done_after is not None:
                await asyncio.sleep(done_after)
                await ctx.bus.emit("engine.done", EngineDone(reason="completed"))

        asyncio.create_task(_script())
        return []

    return SimpleNamespace(
        start=AsyncMock(side_effect=_start),
        stop=AsyncMock(),
        should_retry=AsyncMock(return_value=(False, 0.0)),
    )


def _supervisor(tmp_path, resolver, engine, *, recording=False, **settings_kw) -> SessionSupervisor:
    sup = SessionSupervisor(
        1, _session(recording), engine, resolver, MirrorrSettings(base_dir=tmp_path, **settings_kw)
    )
    sup._connect_nats = AsyncMock(side_effect=lambda: setattr(sup, "_nc", AsyncMock()))
    sup._disconnect_nats = AsyncMock()
    return sup


def _drive(sup, *, full_run: bool):
    """Run the gate with the module seams patched; return (result, delete_mock, calls)."""
    calls: list[dict] = []

    async def _update(settings, session_id, **fields):
        calls.append(fields)
        return {}

    async def scenario():
        delete = AsyncMock()
        ctx = (
            patch.object(session_supervisor, "build_session_urls", lambda *a, **k: []),
            patch.object(session_supervisor, "update_session", _update),
            patch.object(session_supervisor, "delete_session", delete),
            patch("mirrorr.startup.ensure_resolvers.get_validated_config", lambda **k: {}),
        )
        for p in ctx:
            p.start()
        try:
            if full_run:
                await asyncio.wait_for(sup.run(), timeout=5)
                result = None
            else:
                result = await asyncio.wait_for(sup._run_attempt(), timeout=5)
            return result, delete
        finally:
            for p in ctx:
                p.stop()

    result, delete = asyncio.run(scenario())
    return result, delete, calls


def _statuses(calls: list[dict]) -> list[SessionStatus]:
    return [c["status"] for c in calls if "status" in c]


def _last_reason(calls: list[dict]) -> str | None:
    attempts = [c["attempts"] for c in calls if "attempts" in c][-1]
    return attempts[-1]["reason"]


# ── the happy path ────────────────────────────────────────────────────

def test_gate_publishes_initializing_then_pending_then_active(tmp_path):
    sup = _supervisor(tmp_path, _resolver(), _engine(playlist_after=0.05, done_after=0.7))

    result, _delete, calls = _drive(sup, full_run=False)

    assert result[0] == "done"
    assert _statuses(calls) == [
        SessionStatus.INITIALIZING,
        SessionStatus.STREAM_PENDING,
        SessionStatus.ACTIVE,
    ]
    assert sup._playable is True
    assert not any("started_at" in c for c in calls)


def test_gate_publishes_recording_when_the_session_records(tmp_path):
    sup = _supervisor(
        tmp_path, _resolver(), _engine(playlist_after=0.05, done_after=0.7), recording=True
    )

    _result, _delete, calls = _drive(sup, full_run=False)

    assert _statuses(calls) == [
        SessionStatus.INITIALIZING,
        SessionStatus.STREAM_PENDING,
        SessionStatus.RECORDING,
    ]


def test_urls_are_published_at_initializing(tmp_path):
    sup = _supervisor(tmp_path, _resolver(), _engine(playlist_after=0.05, done_after=0.7))

    _result, _delete, calls = _drive(sup, full_run=False)

    first = calls[0]
    assert first["status"] == SessionStatus.INITIALIZING
    assert "session_urls" in first
    assert "session_folder" in first


# ── failure: resolve / smoke / timeout, row kept with a reason ─────────

def test_resolve_failure_keeps_the_row_and_records_a_reason(tmp_path):
    async def boom(config, ctx):
        raise RuntimeError("upstream 404")

    sup = _supervisor(tmp_path, _resolver(resolve=boom), _engine())

    _result, delete, calls = _drive(sup, full_run=True)

    assert _statuses(calls)[-1] == SessionStatus.FAILED
    assert "404" in _last_reason(calls)
    delete.assert_not_awaited()


def test_smoke_failure_keeps_the_row_and_records_a_reason(tmp_path):
    async def bad_smoke(source, config, ctx):
        raise RuntimeError("no video found")

    sup = _supervisor(tmp_path, _resolver(smoke_test=bad_smoke), _engine())

    _result, delete, calls = _drive(sup, full_run=True)

    assert _statuses(calls)[-1] == SessionStatus.FAILED
    assert "smoke test failed" in _last_reason(calls)
    delete.assert_not_awaited()


def test_smoke_timeout_fails_with_a_timeout_reason(tmp_path):
    async def hangs(source, config, ctx):
        await asyncio.sleep(30)

    sup = _supervisor(
        tmp_path, _resolver(smoke_test=hangs), _engine(), smoke_test_timeout_s=0.05
    )

    _result, _delete, calls = _drive(sup, full_run=True)

    assert _statuses(calls)[-1] == SessionStatus.FAILED
    assert "timed out" in _last_reason(calls)


# ── a resolver that defines no smoke_test (base no-op) ─────────────────

class _BaseResolver(ResolverInterface[BaseModel]):
    @property
    def name(self) -> str:
        return "base"

    @property
    def description(self) -> str:
        return ""

    @property
    def config_model(self) -> type[BaseModel]:
        return BaseModel

    async def resolve(self, config, context) -> Source:
        return Source(url="http://example/stream")


def test_resolver_without_smoke_test_proceeds(tmp_path):
    sup = _supervisor(tmp_path, _BaseResolver(), _engine(playlist_after=0.05, done_after=0.7))

    result, _delete, calls = _drive(sup, full_run=False)

    assert result[0] == "done"
    assert _statuses(calls)[-1] == SessionStatus.ACTIVE


# ── stop during either gate state ─────────────────────────────────────

def test_stop_during_initializing_aborts_before_the_engine_starts(tmp_path):
    holder: dict = {}

    async def stop_early(source, config, ctx):
        holder["sup"].request_stop()

    engine = _engine(playlist_after=0.05, done_after=0.7)
    sup = _supervisor(tmp_path, _resolver(smoke_test=stop_early), engine)
    holder["sup"] = sup

    result, _delete, calls = _drive(sup, full_run=False)

    assert result == ("stopped", None)
    assert SessionStatus.ACTIVE not in _statuses(calls)
    engine.start.assert_not_awaited()


def test_stop_during_stream_pending_never_marks_active(tmp_path):
    holder: dict = {}

    async def stop_later(ctx):
        await asyncio.sleep(0.1)
        holder["sup"].request_stop()

    sup = _supervisor(tmp_path, _resolver(), _engine(on_start=stop_later))
    holder["sup"] = sup

    result, _delete, calls = _drive(sup, full_run=False)

    assert result == ("stopped", None)
    assert _statuses(calls) == [SessionStatus.INITIALIZING, SessionStatus.STREAM_PENDING]


# ── the recording toggle must not fabricate a playable state ────────────

def _toggle(sup, command: str) -> list[dict]:
    sup.session_folder.mkdir(parents=True, exist_ok=True)
    calls: list[dict] = []

    async def _update(settings, session_id, **fields):
        fields.pop("nc", None)
        calls.append(fields)
        return {}

    async def scenario():
        with patch.object(session_supervisor, "update_session", _update):
            await sup._handle_control(command)
            if sup._recording:
                await sup._recording.stop_stash()

    asyncio.run(scenario())
    return calls


def test_recording_toggle_cannot_make_a_pre_gate_session_playable(tmp_path):
    sup = _supervisor(tmp_path, _resolver(), _engine())

    calls = _toggle(sup, "enable_recording")

    assert calls == [{"recording": True}]


def test_recording_toggle_moves_a_playable_session(tmp_path):
    sup = _supervisor(tmp_path, _resolver(), _engine())
    sup._playable = True

    calls = _toggle(sup, "enable_recording")

    assert calls == [{"recording": True, "status": SessionStatus.RECORDING}]


# ── started_at belongs to the playable transition, not the gate states ──

def _engine_and_maker():
    engine = create_async_engine("sqlite+aiosqlite://")
    maker = async_sessionmaker(engine, class_=SQLModelAsyncSession, expire_on_commit=False)
    return engine, maker


def test_a_session_row_is_born_initializing():
    row = Session(id=1, engine_id=1, resolver_id=1, requester_user_token="u")
    assert row.status == SessionStatus.INITIALIZING


def test_started_at_is_stamped_only_once_playable(tmp_path):
    async def scenario():
        engine, maker = _engine_and_maker()
        async with engine.begin() as conn:
            await conn.run_sync(SQLModel.metadata.create_all)
        async with maker() as db:
            db.add(Session(id=1, engine_id=1, resolver_id=1, requester_user_token="u"))
            await db.commit()

        settings = MirrorrSettings(base_dir=tmp_path)
        container.configure(settings=settings, session_factory=maker, event_bus=AsyncMock())
        try:
            await update_session(
                settings, 1,
                session_urls=[{"label": "M3U8", "url": "x"}],
                nc=AsyncMock(),
            )
            await update_session(settings, 1, status=SessionStatus.STREAM_PENDING, nc=AsyncMock())
            async with maker() as db:
                assert (await crud.get_by_id(db, Session, 1)).started_at is None

            await update_session(settings, 1, status=SessionStatus.ACTIVE, nc=AsyncMock())
            async with maker() as db:
                assert (await crud.get_by_id(db, Session, 1)).started_at is not None
        finally:
            container.reset()
        await engine.dispose()

    asyncio.run(scenario())
