from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from mirrorr.plugin_api.interfaces import Source
from mirrorr.services import session_supervisor
from mirrorr.services.session_supervisor import SessionSupervisor
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


def _supervisor(tmp_path, resolver) -> SessionSupervisor:
    engine = SimpleNamespace(start=AsyncMock(return_value=[]), stop=AsyncMock())
    sup = SessionSupervisor(1, _session(), engine, resolver, MirrorrSettings(base_dir=tmp_path))
    sup._connect_nats = AsyncMock(side_effect=lambda: setattr(sup, "_nc", AsyncMock()))
    return sup


def _patches():
    return (
        patch.object(session_supervisor, "make_session_dirs", AsyncMock()),
        patch.object(session_supervisor, "build_session_urls", lambda *a, **k: []),
        patch.object(session_supervisor, "update_session", AsyncMock()),
        patch("mirrorr.startup.ensure_resolvers.get_validated_config", lambda **k: {}),
    )


def _run_attempt(tmp_path, resolver, sup):
    async def scenario():
        ctx = _patches()
        for p in ctx:
            p.start()
        try:
            return await asyncio.wait_for(sup._run_attempt(), timeout=5)
        finally:
            for p in ctx:
                p.stop()

    return asyncio.run(scenario())


def test_stop_during_bootstrap_ends_the_attempt(tmp_path):
    """A stop landing while the attempt bootstraps must end it.

    The old code subscribed to a one-shot ``session.stop_requested`` bus
    message *after* ``engine.start`` — a stop emitted during resolve was
    dropped, and ``asyncio.wait`` then blocked forever on a queue that could
    never fire. The latch closes that window.
    """

    async def resolve(config, ctx):
        sup.request_stop()
        return Source(url="http://example/x")

    resolver = SimpleNamespace(resolve=resolve, smoke_test=AsyncMock(), stop=AsyncMock())
    sup = _supervisor(tmp_path, resolver)

    assert _run_attempt(tmp_path, resolver, sup) == ("stopped", None)


def test_stop_before_attempt_skips_start(tmp_path):
    resolver = SimpleNamespace(resolve=AsyncMock(), smoke_test=AsyncMock(), stop=AsyncMock())
    sup = _supervisor(tmp_path, resolver)
    sup.request_stop()

    assert _run_attempt(tmp_path, resolver, sup) == ("stopped", None)
    sup.engine.start.assert_not_awaited()
    resolver.resolve.assert_not_awaited()
