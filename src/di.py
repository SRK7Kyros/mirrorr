"""Lightweight dependency injection container.

Provides a single place to store and retrieve application-wide singletons
(settings, session factory, event bus). Avoids module-level globals scattered
across the codebase and makes testing easier by allowing swap-out of
implementations.

Usage:
    from src.di import container

    # During boot:
    container.configure(settings=settings, session_factory=factory, event_bus=bus)

    # Anywhere else:
    settings = container.settings
    session_factory = container.session_factory
    event_bus = container.event_bus
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from src.startup.config import MirrorrSettings
    from src.event_bus.protocol import EventBus


class _Container:
    """Mutable holder for application-wide singletons.

    Attributes are set once during boot and read from everywhere else.
    Setting an attribute that is already configured raises on double-boot
    (safety net against accidental re-initialisation).
    """

    def __init__(self) -> None:
        self._settings: MirrorrSettings | None = None
        self._session_factory: async_sessionmaker | None = None
        self._event_bus: EventBus | None = None
        self._configured = False

    # ── configuration ────────────────────────────────────────────────

    def configure(
        self,
        *,
        settings: MirrorrSettings,
        session_factory: async_sessionmaker,
        event_bus: EventBus,
    ) -> None:
        """Wire up all singletons.  Called once by MirrorrCore._boot()."""
        if self._configured:
            raise RuntimeError("DI container already configured — double boot?")
        self._settings = settings
        self._session_factory = session_factory
        self._event_bus = event_bus
        self._configured = True

    def reset(self) -> None:
        """Reset all singletons.  For testing only."""
        self._settings = None
        self._session_factory = None
        self._event_bus = None
        self._configured = False

    # ── accessors ────────────────────────────────────────────────────

    @property
    def settings(self) -> MirrorrSettings:
        if self._settings is None:
            raise RuntimeError("Container not configured. Call container.configure() first.")
        return self._settings

    @property
    def session_factory(self) -> async_sessionmaker:
        if self._session_factory is None:
            raise RuntimeError("Container not configured. Call container.configure() first.")
        return self._session_factory

    @property
    def event_bus(self) -> EventBus:
        if self._event_bus is None:
            raise RuntimeError("Container not configured. Call container.configure() first.")
        return self._event_bus


# Module-level singleton — import and use directly.
container = _Container()
