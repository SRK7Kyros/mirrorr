"""Plugin interfaces, data types, and context objects.

Extracted from storage.models to separate plugin concerns from DB models.
Plugins (engines, resolvers) import from here instead of from storage.
"""

from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Generic, Type, TypeVar

from pydantic import BaseModel

from mirrorr.plugins.retry import (
    NoRetry,
    RetryAlways,
    RetryCount,
    RetryOnExitCode,
)
from mirrorr.services.process_bus import ProcessBus, EngineCrashed
from mirrorr.services.managed_process import ManagedProcess


ConfigT = TypeVar("ConfigT", bound=BaseModel)


# ── Data types ────────────────────────────────────────────────────────


@dataclass
class Source:
    """The result of a resolver's work: a direct URL + optional headers
    that an engine can consume to start ingesting a stream."""
    url: str
    headers: dict[str, str] | None = None


class Capabilities(BaseModel):
    """What an engine can do. Must be a Pydantic model for DB serialization."""
    can_record: bool = False
    can_playlist: bool = False


@dataclass
class EngineContext:
    """Runtime environment provided to an engine by the supervisor."""
    bus: ProcessBus
    session_folder: Path
    logs_folder: Path
    segments_folder: Path
    hls_window: int = 60
    segment_duration: int = 10
    _tasks: list[asyncio.Task] = field(default_factory=list)


@dataclass
class ResolverContext:
    """Runtime environment provided to a resolver by the supervisor."""
    bus: ProcessBus
    session_folder: Path


# ── Plugin ABCs ───────────────────────────────────────────────────────


class EngineInterface(ABC):
    """Interface that every engine plugin must implement.

    An engine is responsible for:
    - Defining its capabilities
    - Defining retry modes it supports (and their parameter schemas)
    - Starting processes that produce HLS output
    - Defining what happens when processes exit (retry, crash, complete)
    - Signaling ``engine.done`` or ``engine.crashed`` to the supervisor
    """

    @property
    @abstractmethod
    def name(self) -> str:
        ...

    @property
    @abstractmethod
    def description(self) -> str:
        ...

    @property
    @abstractmethod
    def capabilities(self) -> Capabilities:
        ...

    @property
    def retry_modes(self) -> dict[str, type[BaseModel]]:
        """Map of mode_key → Pydantic model class defining parameters.
        Override to customize which retry modes are available.
        Default: no retry, retry always, retry N times."""
        return {
            "none": NoRetry,
            "always": RetryAlways,
            "count": RetryCount,
            "exit_code": RetryOnExitCode,
        }

    @abstractmethod
    async def start(self, context: EngineContext, source: Source) -> list[ManagedProcess]:
        ...

    async def stop(self, context: EngineContext, reason: str = "stop") -> None:
        """Called when the session is being cleaned up.

        reason is one of:
        - "stop": user requested stop or session completed normally
        - "retry": crashed, about to retry
        - "failed": crashed, giving up

        Override to run engine-specific cleanup (flush remote buffers,
        kill sidecars, etc). The supervisor will cancel your tasks
        and terminate processes after this returns."""
        ...

    async def should_retry(
        self,
        crash: EngineCrashed,
        attempt: int,
        config: dict[str, Any],
    ) -> tuple[bool, float]:
        """Decide whether to retry after a crash.

        Called by the supervisor after each crash. Returns (retry, delay).
        - retry=True, delay=N: retry after N seconds
        - retry=False: give up, mark session as FAILED

        Default implementation handles none/always/count/exit_code modes
        using the session's retry_mode + retry_config. Engines can override
        this to implement any custom retry logic (e.g. backoff, per-error
        classification, adaptive retries)."""
        from mirrorr.plugins.retry import (
            get_retry_max_attempts,
            get_retry_delay,
            get_retryable_exit_codes,
        )

        mode = config.get("mode", "none")
        params = config.get("params", {})
        retryable_codes = get_retryable_exit_codes(mode, params)

        # exit_code mode: only retry if the exit code matches
        if retryable_codes is not None:
            rc = crash.returncode
            if rc is not None and rc in retryable_codes:
                return True, get_retry_delay(mode, params)
            return False, 0.0

        # none/always/count modes
        max_attempts = get_retry_max_attempts(mode, params)
        if max_attempts is not None and attempt >= max_attempts:
            return False, 0.0

        if mode == "none":
            return False, 0.0

        delay = get_retry_delay(mode, params)
        if config.get("mode") == "retry_always":
            delay = max(delay, 2.0)

        return True, delay


class ResolverInterface(ABC, Generic[ConfigT]):
    """Interface that every resolver plugin must implement.

    A resolver is responsible for:
    - Validating its configuration
    - Resolving a high-level config into a direct ``Source``
    - Optionally running ongoing processes (proxies, scrapers) and
      emitting events to the bus when conditions change
    """

    @property
    @abstractmethod
    def name(self) -> str:
        ...

    @property
    @abstractmethod
    def description(self) -> str:
        ...

    @property
    @abstractmethod
    def config_model(self) -> Type[ConfigT]:
        ...

    @abstractmethod
    async def resolve(self, config: ConfigT, context: ResolverContext) -> Source:
        """Resolve config into a Source. Can emit ``engine.restart`` on the
        bus to tell the engine to re-resolve (e.g., URL expiry)."""
        ...

    async def stop(self, context: ResolverContext) -> None:
        """Called when the supervisor shuts down. Override to clean up."""
        ...
