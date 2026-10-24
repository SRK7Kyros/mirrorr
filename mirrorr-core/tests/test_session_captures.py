"""One session, several captures: the plan, the handover, and the single recording.

A session's ``capture_plan`` lists the profiles it tries in turn. A capture that
never becomes playable hands over to the next source instead of failing the
session, and whatever the captures recorded merges into one recording.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from mirrorr.plugin_api.interfaces import Source
from mirrorr.services import session_supervisor
from mirrorr.services.process_bus import EngineCrashed, EngineDone
from mirrorr.services.session_supervisor import SessionSupervisor
from mirrorr.startup.config import MirrorrSettings
from mirrorr.storage.enums import SessionStatus

FALLBACK_CAPTURE = {
    "profile_id": 2,
    "profile_name": "F1 UK",
    "engine_name": "yt-dlp piped",
    "resolver_name": "tvnow247",
    "resolver_origin": "tvnow247",
    "resolver_hash": "h2",
    "resolver_config": {"channel": "60"},
    "retry_mode": "none",
    "retry_config": {},
}


def _session(plan: list[int], *, recording: bool = True) -> SimpleNamespace:
    return SimpleNamespace(
        id=1,
        is_autorun=True,
        autorun=SimpleNamespace(profile_id=1, snake_case_name="f1_race"),
        autorun_id=1,
        profile=SimpleNamespace(id=1, name="F1"),
        profile_id=1,
        engine=SimpleNamespace(name="yt-dlp piped"),
        recording=recording,
        resolver=SimpleNamespace(name="tvnow247", origin="tvnow247", origin_hash="h1"),
        resolver_config={"channel": "577"},
        retry_mode="none",
        retry_config={},
        retry_attempts=0,
        attempts=[],
        captures=[],
        capture_plan=plan,
    )


def _resolver() -> SimpleNamespace:
    async def _resolve(config, ctx):
        return Source(url=f"http://example/{config or 'primary'}")

    return SimpleNamespace(
        resolve=_resolve,
        smoke_test=AsyncMock(),
        stop=AsyncMock(),
    )


def _engine(*, ends="done") -> SimpleNamespace:
    async def _start(ctx, source):
        async def _script():
            await asyncio.sleep(0.02)
            (ctx.session_folder / "stream.m3u8").write_text("x")
            await asyncio.sleep(0.05)
            if ends == "done":
                await ctx.bus.emit("engine.done", EngineDone(reason="completed"))
            elif ends == "crash":
                await ctx.bus.emit("engine.crashed", EngineCrashed(reason="boom"))

        asyncio.create_task(_script())
        return []

    return SimpleNamespace(
        start=AsyncMock(side_effect=_start),
        stop=AsyncMock(),
        should_retry=AsyncMock(return_value=(False, 0.0)),
    )


def _sup(tmp_path, *, plan, engine, resolver=None, recording=True) -> SessionSupervisor:
    sup = SessionSupervisor(
        1,
        _session(plan, recording=recording),
        engine,
        resolver or _resolver(),
        MirrorrSettings(base_dir=tmp_path),
    )
    sup._connect_nats = AsyncMock(side_effect=lambda: setattr(sup, "_nc", AsyncMock()))
    sup._disconnect_nats = AsyncMock()
    return sup


def _drive(sup, *, load_capture=None):
    """Run the session with the seams patched; return (calls, finalize, load_capture)."""
    calls: list[dict] = []

    async def _update(settings, session_id, **fields):
        calls.append(fields)
        return {}

    async def _remux_capture():
        folder = sup._recording.session_folder
        if not (folder / "stream.m3u8").exists():
            return None
        target = folder / f"{folder.name}.mp4"
        target.write_bytes(b"\x00")
        return target

    finalize = AsyncMock(return_value=7)
    load_capture = load_capture or AsyncMock(
        return_value=(FALLBACK_CAPTURE, _engine(ends="done"), _resolver())
    )

    async def scenario():
        ctx = [
            patch.object(session_supervisor, "build_session_urls", lambda *a, **k: []),
            patch.object(session_supervisor, "update_session", _update),
            patch.object(session_supervisor, "delete_session", AsyncMock()),
            patch.object(session_supervisor, "live_folder_holder", AsyncMock(return_value=None)),
            patch.object(session_supervisor, "load_profile_capture", load_capture),
            patch("mirrorr.startup.ensure_resolvers.get_validated_config", lambda **k: {}),
            patch.object(session_supervisor.RecordingManager, "start_stash", Mock()),
            patch.object(session_supervisor.RecordingManager, "stop_stash", AsyncMock()),
            patch.object(session_supervisor.RecordingManager, "remux_capture", staticmethod(_remux_capture)),
            patch.object(session_supervisor.RecordingManager, "probe_duration", AsyncMock(return_value=2.0)),
            patch.object(session_supervisor.RecordingManager, "finalize", finalize),
        ]
        for p in ctx:
            p.start()
        try:
            await asyncio.wait_for(sup.run(), timeout=5)
        finally:
            for p in ctx:
                p.stop()

    asyncio.run(scenario())
    return calls, finalize, load_capture


def _statuses(calls: list[dict]) -> list[SessionStatus]:
    return [c["status"] for c in calls if "status" in c]


def _captures(calls: list[dict]) -> list[dict]:
    return [c["captures"] for c in calls if "captures" in c][-1]


def test_a_failed_capture_hands_over_and_both_artifacts_merge_into_one_recording(tmp_path):
    primary = _engine(ends="crash")
    sup = _sup(tmp_path, plan=[1, 2], engine=primary)

    calls, finalize, load_capture = _drive(sup)

    load_capture.assert_awaited_once_with(sup.settings, 2)
    assert primary.start.await_count == 1

    captures = _captures(calls)
    assert [(s["index"], s["status"]) for s in captures] == [(1, "failed"), (2, "completed")]
    assert captures[1]["profile_name"] == "F1 UK"

    artifacts, producer = finalize.call_args.args
    assert len(artifacts) == 2
    assert artifacts[0].parent == sup._primary_folder
    assert artifacts[1].parent == sup._primary_folder.parent / f"{sup._primary_folder.name}_capture2"
    assert producer["profile_id"] == 2
    assert all(s["merged"] for s in _captures(calls))

    statuses = _statuses(calls)
    assert statuses[-1] is SessionStatus.COMPLETED
    assert SessionStatus.FAILED not in statuses


def test_every_capture_failing_keeps_the_row_failed_with_what_they_recorded(tmp_path):
    sup = _sup(tmp_path, plan=[1, 2], engine=_engine(ends="crash"))
    crash_again = AsyncMock(
        return_value=(FALLBACK_CAPTURE, _engine(ends="crash"), _resolver())
    )

    calls, finalize, _load = _drive(sup, load_capture=crash_again)

    captures = _captures(calls)
    assert [(s["index"], s["status"]) for s in captures] == [(1, "failed"), (2, "failed")]
    artifacts, producer = finalize.call_args.args
    assert len(artifacts) == 2
    assert producer["profile_id"] == 2
    assert _statuses(calls)[-1] is SessionStatus.FAILED


def _drive_with_stop(sup, *, after=0.05):
    calls: list[dict] = []

    async def _update(settings, session_id, **fields):
        calls.append(fields)
        return {}

    async def scenario():
        load_capture = AsyncMock()
        ctx = [
            patch.object(session_supervisor, "build_session_urls", lambda *a, **k: []),
            patch.object(session_supervisor, "update_session", _update),
            patch.object(session_supervisor, "delete_session", AsyncMock()),
            patch.object(session_supervisor, "live_folder_holder", AsyncMock(return_value=None)),
            patch.object(session_supervisor, "load_profile_capture", load_capture),
            patch("mirrorr.startup.ensure_resolvers.get_validated_config", lambda **k: {}),
        ]
        for p in ctx:
            p.start()
        try:
            asyncio.create_task(_stop_later())
            await asyncio.wait_for(sup.run(), timeout=5)
        finally:
            for p in ctx:
                p.stop()
        return load_capture

    async def _stop_later():
        await asyncio.sleep(after)
        sup.request_stop()

    load_capture = asyncio.run(scenario())
    return calls, load_capture


def test_a_stop_during_the_first_capture_never_tries_the_next_source(tmp_path):
    sup = _sup(tmp_path, plan=[1, 2], engine=_engine(), recording=False)

    calls, load_capture = _drive_with_stop(sup)

    load_capture.assert_not_awaited()
    assert [s["index"] for s in _captures(calls)] == [1]
    assert _statuses(calls)[-1] is SessionStatus.COMPLETED


def test_a_profile_that_cannot_load_fails_its_capture_and_the_next_still_runs(tmp_path):
    async def _boom(*a, **k):
        raise ValueError("Profile 2 has no resolver or engine")

    sup = _sup(tmp_path, plan=[1, 2], engine=_engine(ends="crash"))

    calls, finalize, _load = _drive(sup, load_capture=AsyncMock(side_effect=_boom))

    captures = _captures(calls)
    assert [s["index"] for s in captures] == [1, 2]
    assert captures[1]["status"] == "failed"
    assert "Profile 2 has no resolver or engine" in captures[1]["reason"]
    assert _statuses(calls)[-1] is SessionStatus.FAILED
    artifacts, _producer = finalize.call_args.args
    assert len(artifacts) == 1
