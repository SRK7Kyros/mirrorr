"""Retry mode schemas and utilities for engine plugins.

Extracted from storage.models to separate plugin concerns from DB models.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


# ── Generic retry mode schemas ────────────────────────────────────────


class NoRetry(BaseModel):
    """Retry mode: do not retry on crash."""
    pass


class RetryAlways(BaseModel):
    """Retry mode: always restart on crash."""
    pass


class RetryCount(BaseModel):
    """Retry mode: restart up to N times with optional delay."""
    count: int = Field(default=3, ge=1, description="Maximum number of retry attempts")
    delay: float = Field(default=5.0, ge=0, description="Seconds to wait before retrying")


class RetryOnExitCode(BaseModel):
    """Retry mode: only retry when the process exits with specific codes."""
    codes: list[int] = Field(default=[1], description="Exit codes that should trigger a retry")
    delay: float = Field(default=5.0, ge=0, description="Seconds to wait before retrying")


# ── Utility functions ─────────────────────────────────────────────────


def build_retry_modes_schema(modes: dict[str, type[BaseModel]]) -> dict[str, Any]:
    """Generate the serializable schema dict for a set of retry modes."""
    result: dict[str, Any] = {}
    for key, model in modes.items():
        entry: dict[str, Any] = {
            "schema": model.model_json_schema(),
            "default_params": model().model_dump(),
        }
        # Free-gain enrichment: tell the form what `exit_code` mode will retry
        # on, so the UI can render "retries on crash with exit code ∈ {1}"
        # without shelling out to retry logic.
        if key == "exit_code":
            entry["retryable_exit_codes"] = get_retryable_exit_codes(key, model().model_dump())
        result[key] = entry
    return result


def get_retry_delay(mode: str, config: dict[str, Any]) -> float:
    """Extract the retry delay for a given mode+config, or 0 if not applicable."""
    if mode in ("count", "exit_code"):
        return float(config.get("delay", 5.0))
    return 0.0


def get_retry_max_attempts(mode: str, config: dict[str, Any]) -> int | None:
    """Return max attempts for 'count' mode, or None for infinite."""
    if mode == "count":
        return int(config.get("count", 3))
    if mode in ("always", "exit_code"):
        return None  # infinite
    return 0  # no retry


def get_retryable_exit_codes(mode: str, config: dict[str, Any]) -> list[int] | None:
    """Return the list of retryable exit codes for 'exit_code' mode, or None."""
    if mode == "exit_code":
        return config.get("codes", [1])
    return None
