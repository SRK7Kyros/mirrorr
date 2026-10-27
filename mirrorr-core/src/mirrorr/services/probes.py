"""Pre-flight one source without starting a session.

A chain rung is only proven when it fires at 03:00, which is the worst moment to
learn that a resolver has gone dark. A probe runs exactly what a run's own
capture does before its engine starts — validate the config, resolve, smoke test
under the same budget — and answers the three facts an operator needs: whether
it works, how long it took, and why it did not.

The verdict is remembered against ``source_key`` (engine + resolver + sorted
config, the identity a chain already uses), so the editor can mark a rung that
was last seen failing without probing it again. A probe is a *check*, not a run:
no session row, no folder in the library, no engine.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from mirrorr.services.fallback_chain import source_key
from mirrorr.storage.models import Resolver, ResolverProbe

#: Where a probe keeps whatever the resolver caches (its discovery documents).
#: One folder per resolver origin, shared by every probe of it — and separate
#: from a session's scratch folder, so a check can never disturb a live capture.
PROBE_CACHE = "probe"

#: A validation error's text is a multi-line wall of pydantic prose. The editor
#: shows one sentence, so it gets the head of it.
ERROR_CHARS = 400


@dataclass(frozen=True)
class ProbeResult:
    """What one probe found — a failure is an answer, not an error."""

    ok: bool
    latency_ms: int
    error: str = ""
    source_url: str = ""
    checked_at: datetime | None = None


def key_for(engine_id: int | None, resolver_id: int, config: Any) -> str:
    """The identity a verdict is remembered under.

    An engine is part of the identity because a chain's ``source_key`` includes
    it: the same stream through a different engine is a different capture. A
    probe that names no engine is keyed at ``0`` and therefore never matches a
    rung's own — the UI always sends the engine a rung resolves to.
    """
    return source_key(engine_id or 0, resolver_id, config)


def _describe(exc: BaseException) -> str:
    """The shortest one-line sentence that still says what went wrong."""
    text = " ".join(str(exc).split())
    if not text:
        return type(exc).__name__
    return text if len(text) <= ERROR_CHARS else f"{text[: ERROR_CHARS - 1]}…"


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def run(
    settings: Any,
    resolver: Resolver,
    engine_id: int | None,
    config_data: dict[str, Any],
    *,
    bus: Any = None,
    timeout: float | None = None,
) -> ProbeResult:
    """Resolve and smoke-test one resolver config, timing the whole check."""
    # Imported here so importing this module stays free of the plugin machinery
    # (and of a cycle: the loaders import storage models).
    from mirrorr.plugin_api.interfaces import ResolverContext
    from mirrorr.startup.ensure_resolvers import load_resolver_jit

    started = time.monotonic()

    def elapsed_ms() -> int:
        return int((time.monotonic() - started) * 1000)

    try:
        interface = load_resolver_jit(settings.resolvers_dir, resolver.origin, resolver.origin_hash)
        config = interface.config_model(**dict(config_data or {}))
    except Exception as exc:  # noqa: BLE001 - any validation failure is the answer
        return ProbeResult(
            ok=False,
            latency_ms=elapsed_ms(),
            error=f"config rejected: {_describe(exc)}",
            checked_at=_now(),
        )

    scratch = settings.base_dir / "cache" / PROBE_CACHE / resolver.origin
    scratch.mkdir(parents=True, exist_ok=True)
    context = ResolverContext(bus=bus, session_folder=scratch)

    try:
        source = await interface.resolve(config, context)
    except Exception as exc:  # noqa: BLE001
        return ProbeResult(
            ok=False,
            latency_ms=elapsed_ms(),
            error=f"resolve failed: {_describe(exc)}",
            checked_at=_now(),
        )

    budget = settings.smoke_test_timeout_s if timeout is None else timeout
    try:
        # The gate a scheduled run applies, under the same budget — a smoke test
        # that never answers must not hold the check open for ever.
        await asyncio.wait_for(interface.smoke_test(source, config, context), timeout=budget)
    except asyncio.TimeoutError:
        return ProbeResult(
            ok=False,
            latency_ms=elapsed_ms(),
            error=f"smoke test timed out after {budget:g}s",
            source_url=source.url,
            checked_at=_now(),
        )
    except Exception as exc:  # noqa: BLE001
        return ProbeResult(
            ok=False,
            latency_ms=elapsed_ms(),
            error=f"smoke test failed: {_describe(exc)}",
            source_url=source.url,
            checked_at=_now(),
        )

    return ProbeResult(ok=True, latency_ms=elapsed_ms(), source_url=source.url, checked_at=_now())


async def remember(
    db: Any, result: ProbeResult, resolver_id: int, key: str, requester: str = ""
) -> ResolverProbe:
    """Store the newest verdict for one identity, replacing any earlier one."""
    row = await db.get(ResolverProbe, key)
    if row is None:
        row = ResolverProbe(source_key=key, resolver_id=resolver_id)
        db.add(row)
    row.resolver_id = resolver_id
    row.ok = result.ok
    row.latency_ms = result.latency_ms
    row.error = result.error
    row.source_url = result.source_url
    row.checked_at = result.checked_at or _now()
    row.requester_user_token = requester
    return row


def verdict(row: ResolverProbe | None) -> dict[str, Any] | None:
    """A stored verdict as the wire shape, or ``None`` when it was never probed."""
    if row is None:
        return None
    return {
        "ok": row.ok,
        "latency_ms": row.latency_ms,
        "error": row.error or None,
        "source_url": row.source_url or None,
        "checked_at": row.checked_at,
    }
