from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from mirrorr.api import ws
from mirrorr.services import session_supervisor
from mirrorr.services.session_supervisor import SessionSupervisor
from mirrorr.services.telemetry import build_frame, record_sample
from mirrorr.startup.config import MirrorrSettings


def _session() -> SimpleNamespace:
    return SimpleNamespace(
        id=1,
        is_autorun=False,
        autorun=None,
        autorun_id=None,
        profile=None,
        recording=False,
        resolver=SimpleNamespace(origin="static", origin_hash="h"),
        resolver_config={},
        retry_mode="none",
        retry_config={},
        retry_attempts=0,
        attempts=[],
    )


def _supervisor(tmp_path) -> SessionSupervisor:
    engine = SimpleNamespace(start=AsyncMock(return_value=[]), stop=AsyncMock())
    sup = SessionSupervisor(1, _session(), engine, SimpleNamespace(), MirrorrSettings(base_dir=tmp_path))
    sup._nc = AsyncMock()
    return sup


def test_record_sample_keeps_the_newest_sample_and_only_published_fields():
    samples: dict[str, dict] = {}
    record_sample(samples, "engine", {"cpu_percent": 1.0, "rss_bytes": 10, "vms_bytes": 20, "pid": 7})
    record_sample(samples, "engine", {"cpu_percent": 2.0, "rss_bytes": 30, "vms_bytes": 40})

    assert samples == {"engine": {"cpu_percent": 2.0, "rss_bytes": 30, "vms_bytes": 40}}


def test_record_sample_ignores_a_sample_with_no_published_field():
    samples: dict[str, dict] = {}
    record_sample(samples, "engine", {"pid": 7})

    assert samples == {}


def test_build_frame_is_none_until_something_was_sampled():
    assert build_frame(1, {}, 0.0) is None


def test_build_frame_coalesces_processes_in_name_order_with_a_rss_total():
    samples: dict[str, dict] = {}
    record_sample(samples, "streamlink", {"cpu_percent": 2.0, "rss_bytes": 200})
    record_sample(samples, "engine", {"cpu_percent": 1.0, "rss_bytes": 100})

    assert build_frame(1, samples, 5.0) == {
        "session_id": 1,
        "ts": 5.0,
        "processes": [
            {"name": "engine", "cpu_percent": 1.0, "rss_bytes": 100},
            {"name": "streamlink", "cpu_percent": 2.0, "rss_bytes": 200},
        ],
        "total_rss_bytes": 300,
    }


def test_telemetry_is_published_as_one_session_level_frame(tmp_path):
    sup = _supervisor(tmp_path)
    sup.processes = [SimpleNamespace(name="engine"), SimpleNamespace(name="streamlink")]

    async def scenario():
        with patch.object(session_supervisor, "TELEMETRY_PUBLISH_INTERVAL_S", 0.01):
            sup._wire_telemetry()
            await sup.bus.emit("proc.engine.telemetry", {"cpu_percent": 1.0, "rss_bytes": 100})
            await sup.bus.emit("proc.streamlink.telemetry", {"cpu_percent": 2.0, "rss_bytes": 200})
            await asyncio.sleep(0.05)
        for task in sup._telemetry_tasks:
            task.cancel()
        await asyncio.gather(*sup._telemetry_tasks, return_exceptions=True)

    asyncio.run(scenario())

    calls = sup._nc.publish.await_args_list
    assert {call.args[0] for call in calls} == {"session.1.telemetry"}
    frame = json.loads(calls[0].args[1])
    assert frame["session_id"] == 1
    assert isinstance(frame["ts"], float)
    assert [process["name"] for process in frame["processes"]] == ["engine", "streamlink"]
    assert frame["total_rss_bytes"] == 300


def test_telemetry_publishes_nothing_before_the_first_sample(tmp_path):
    sup = _supervisor(tmp_path)
    sup.processes = [SimpleNamespace(name="engine")]

    async def scenario():
        with patch.object(session_supervisor, "TELEMETRY_PUBLISH_INTERVAL_S", 0.01):
            sup._wire_telemetry()
            await asyncio.sleep(0.05)
        for task in sup._telemetry_tasks:
            task.cancel()
        await asyncio.gather(*sup._telemetry_tasks, return_exceptions=True)

    asyncio.run(scenario())

    assert sup._nc.publish.await_args_list == []


def test_dropping_the_nats_connection_stops_the_publisher(tmp_path):
    sup = _supervisor(tmp_path)
    sup.processes = [SimpleNamespace(name="engine")]
    sup._nc.publish = AsyncMock(side_effect=OSError("gone"))

    async def scenario():
        with patch.object(session_supervisor, "TELEMETRY_PUBLISH_INTERVAL_S", 0.01):
            sup._wire_telemetry()
            await sup.bus.emit("proc.engine.telemetry", {"cpu_percent": 1.0, "rss_bytes": 100})
            await asyncio.sleep(0.05)
        for task in sup._telemetry_tasks:
            task.cancel()
        await asyncio.gather(*sup._telemetry_tasks, return_exceptions=True)

    asyncio.run(scenario())

    assert len(sup._nc.publish.await_args_list) == 1


def test_ws_skips_per_process_samples_but_not_the_session_level_frame():
    assert ws._should_skip_subject("session.5.telemetry") is False
    assert ws._should_skip_subject("session.5.telemetry.remux") is True
    assert ws._should_skip_subject("session.5.telemetry.engine") is True


def test_ws_forwards_a_per_resource_subject_only_to_its_exact_subscriber():
    subscribed = {("session", 1)}

    assert ws._is_relevant_event("session.1.telemetry", subscribed) is True
    assert ws._is_relevant_event("session.15.telemetry", subscribed) is False
    assert ws._is_relevant_event("session.created", subscribed) is True
    assert ws._is_relevant_event("proc.engine.telemetry", subscribed) is False
