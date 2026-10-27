"""Track B — "test this rung": probing a source without starting a session.

``probes.run`` does what a scheduled capture does before its engine starts —
validate the config, resolve, smoke test under the budget — and answers a
verdict instead of raising. A failure is an answer, so every branch (bad config,
resolve raises, smoke test raises, smoke test never answers) is asserted here.

The route half is driven through the shared ASGI harness with ``probes.run``
patched: the point is the wiring — that a verdict is remembered under the
capture identity, replaced rather than appended, and read back in the order the
editor asked for.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from pydantic import BaseModel

from mirrorr.plugin_api.interfaces import ResolverContext, ResolverInterface, Source
from mirrorr.services import probes
from mirrorr.services.fallback_chain import source_key
from mirrorr.startup.config import MirrorrSettings
from mirrorr.storage.models import Resolver

from test_resource_access import _harness, _seed


class _Config(BaseModel):
    channel: str = ""


class _Fake(ResolverInterface[_Config]):
    """A resolver whose every stage can be made to fail on demand."""

    def __init__(
        self,
        *,
        resolve_error: BaseException | None = None,
        smoke_error: BaseException | None = None,
        smoke_seconds: float = 0.0,
    ) -> None:
        self.resolve_error = resolve_error
        self.smoke_error = smoke_error
        self.smoke_seconds = smoke_seconds

    @property
    def name(self) -> str:
        return "fake"

    @property
    def description(self) -> str:
        return ""

    @property
    def config_model(self) -> type[_Config]:
        return _Config

    async def resolve(self, config: _Config, context: ResolverContext) -> Source:
        if self.resolve_error is not None:
            raise self.resolve_error
        return Source(url=f"https://example.test/{config.channel}.m3u8")

    async def smoke_test(self, source: Source, config: _Config, context: ResolverContext) -> None:
        if self.smoke_seconds:
            await asyncio.sleep(self.smoke_seconds)
        if self.smoke_error is not None:
            raise self.smoke_error


def _settings(tmp_path: Path) -> MirrorrSettings:
    return MirrorrSettings(
        base_dir=tmp_path,
        content_dir=tmp_path / "content",
        resolvers_dir=tmp_path / "resolvers",
        smoke_test_timeout_s=0.2,
    )


def _resolver() -> Resolver:
    return Resolver(id=7, name="fake", description="", origin="fake", origin_hash="h")


def _probe(tmp_path: Path, interface: ResolverInterface, **kwargs) -> probes.ProbeResult:
    """Run a probe with the JIT loader answering ``interface``."""

    async def go() -> probes.ProbeResult:
        return await probes.run(_settings(tmp_path), _resolver(), 3, {"channel": "60"}, **kwargs)

    import mirrorr.startup.ensure_resolvers as ensure

    original = ensure.load_resolver_jit
    ensure.load_resolver_jit = lambda *_args, **_kw: interface  # type: ignore[assignment]
    try:
        return asyncio.run(go())
    finally:
        ensure.load_resolver_jit = original


def test_a_working_source_is_a_yes_with_a_latency(tmp_path):
    result = _probe(tmp_path, _Fake())
    assert result.ok is True
    assert result.error == ""
    assert result.latency_ms >= 0
    assert result.source_url == "https://example.test/60.m3u8"
    assert result.checked_at is not None


def test_a_config_the_plugin_rejects_says_so(tmp_path):
    async def go() -> probes.ProbeResult:
        return await probes.run(_settings(tmp_path), _resolver(), 3, {"nope": 1})

    import mirrorr.startup.ensure_resolvers as ensure

    class _Strict(_Fake):
        @property
        def config_model(self) -> type[_Config]:  # type: ignore[override]
            return _Config

    class _Boom(BaseModel):
        def __init__(self, **_kwargs):  # noqa: D401 - a pydantic model that refuses everything
            raise ValueError("channel is required")

    class _Bad(_Strict):
        @property
        def config_model(self):  # type: ignore[override]
            return _Boom

    original = ensure.load_resolver_jit
    ensure.load_resolver_jit = lambda *_args, **_kw: _Bad()  # type: ignore[assignment]
    try:
        result = asyncio.run(go())
    finally:
        ensure.load_resolver_jit = original

    assert result.ok is False
    assert result.error.startswith("config rejected:")
    assert "channel is required" in result.error


def test_a_resolve_that_raises_is_a_no_not_an_error(tmp_path):
    result = _probe(tmp_path, _Fake(resolve_error=RuntimeError("stream is offline")))
    assert result.ok is False
    assert result.error == "resolve failed: stream is offline"
    assert result.source_url == ""


def test_a_smoke_test_that_raises_carries_the_url_it_tried(tmp_path):
    result = _probe(tmp_path, _Fake(smoke_error=RuntimeError("no segments")))
    assert result.ok is False
    assert result.error == "smoke test failed: no segments"
    assert result.source_url == "https://example.test/60.m3u8"


def test_a_smoke_test_that_never_answers_is_bounded_by_the_budget(tmp_path):
    result = _probe(tmp_path, _Fake(smoke_seconds=5), timeout=0.01)
    assert result.ok is False
    assert result.error == "smoke test timed out after 0.01s"


def test_a_verdict_is_keyed_the_way_a_chain_keys_a_capture():
    config = {"channel": "60", "region": "uk"}
    assert probes.key_for(3, 7, config) == source_key(3, 7, config)
    # A probe that names no engine must never match a rung that does.
    assert probes.key_for(None, 7, config) != probes.key_for(3, 7, config)


def test_a_verdict_of_a_never_probed_capture_is_none():
    assert probes.verdict(None) is None


@pytest.mark.anyio
async def test_the_probe_route_remembers_and_reads_back_a_verdict(tmp_path):
    from mirrorr.services import probes as module

    async def fake_run(*_args, **_kwargs):
        return module.ProbeResult(
            ok=False, latency_ms=42, error="resolve failed: nope", source_url=""
        )

    async with _harness(tmp_path) as h:
        ids = await _seed(h.maker)
        h.as_user("alice", admin=True)
        original = module.run
        module.run = fake_run  # type: ignore[assignment]
        try:
            body = {"resolver_config": {"channel": "60"}, "engine_id": ids["engine"]}
            answer = await h.client.post(f"/resolvers/{ids['resolver']}/probe", json=body)
            assert answer.status_code == 200
            verdict = answer.json()
            assert verdict["ok"] is False
            assert verdict["latency_ms"] == 42
            assert verdict["error"] == "resolve failed: nope"

            lookup = await h.client.post(
                "/resolvers/probes/lookup",
                json={
                    "sources": [
                        {
                            "engine_id": ids["engine"],
                            "resolver_id": ids["resolver"],
                            "resolver_config": {"channel": "60"},
                        },
                        {
                            "engine_id": ids["engine"],
                            "resolver_id": ids["resolver"],
                            "resolver_config": {"channel": "61"},
                        },
                    ]
                },
            )
        finally:
            module.run = original  # type: ignore[assignment]

    assert lookup.status_code == 200
    found = lookup.json()["items"]
    assert len(found) == 2
    assert found[0]["ok"] is False and found[0]["error"] == "resolve failed: nope"
    # Never probed is `null`, not an invented verdict.
    assert found[1] is None
