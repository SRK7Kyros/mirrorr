"""Plugin interfaces, types, and retry utilities.

This package is the canonical import point for plugin authors.
Re-exports everything from interfaces.py and retry.py for convenience.
"""

from src.plugins.interfaces import (
    Capabilities,
    EngineContext,
    EngineInterface,
    ResolverContext,
    ResolverInterface,
    Source,
)
from src.plugins.retry import (
    NoRetry,
    RetryAlways,
    RetryCount,
    RetryOnExitCode,
    build_retry_modes_schema,
    get_retry_delay,
    get_retry_max_attempts,
    get_retryable_exit_codes,
)

__all__ = [
    # Interfaces
    "EngineInterface",
    "ResolverInterface",
    # Data types
    "Source",
    "Capabilities",
    "EngineContext",
    "ResolverContext",
    # Retry schemas
    "NoRetry",
    "RetryAlways",
    "RetryCount",
    "RetryOnExitCode",
    # Retry utilities
    "build_retry_modes_schema",
    "get_retry_delay",
    "get_retry_max_attempts",
    "get_retryable_exit_codes",
]
