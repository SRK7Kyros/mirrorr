from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any


class ProcessBus:
    """In-process async event bus for supervisor-level communication.

    Each supervisor session gets its own bus. ManagedProcess objects publish
    lifecycle events here, and engines subscribe to build coordination logic.

    Topics are dot-separated strings like ``proc.yt-dlp.stdout``,
    ``proc.ffmpeg.exit``, ``engine.done``, ``engine.crashed``.

    Subscribers get an ``asyncio.Queue`` they can ``await`` on.
    """

    def __init__(self) -> None:
        self._subscribers: dict[str, list[asyncio.Queue]] = {}

    def subscribe(self, topic: str) -> asyncio.Queue:
        """Subscribe to a topic. Returns an ``asyncio.Queue`` that receives
        every message published to *topic* from this point forward."""
        q: asyncio.Queue = asyncio.Queue()
        self._subscribers.setdefault(topic, []).append(q)
        return q

    async def emit(self, topic: str, data: Any = None) -> None:
        """Publish *data* to *topic*. All current subscribers receive it."""
        for q in self._subscribers.get(topic, []):
            await q.put(data)

    def subscriber_count(self, topic: str) -> int:
        """How many subscribers exist for *topic*."""
        return len(self._subscribers.get(topic, []))


# ── Standardized process exit data ────────────────────────────────────

@dataclass(frozen=True)
class ProcessExit:
    """Published to ``proc.<name>.exit`` when a subprocess exits."""
    returncode: int
    name: str
    intentional: bool = False


@dataclass(frozen=True)
class ProcessOutput:
    """Published to ``proc.<name>.stdout`` / ``proc.<name>.stderr``."""
    line: str
    name: str
    stream: str  # "stdout" | "stderr"


# ── Standard engine lifecycle events ──────────────────────────────────

@dataclass(frozen=True)
class EngineDone:
    """Published to ``engine.done`` when the engine considers the session complete."""
    reason: str = "completed"


@dataclass(frozen=True)
class EngineCrashed:
    """Published to ``engine.crashed`` when the engine considers the session failed."""
    reason: str = "unknown"
    source_process: str | None = None
