"""Abstract protocol for the event bus.

Defines the interface that any event bus implementation (NATS, in-memory,
test mock) must satisfy. Used for dependency injection and testability.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable
from typing import Any, Type

from src.event_bus.event import BaseEvent


class EventBus(ABC):
    """Abstract event bus interface.

    Concrete implementations (e.g. NatsRegistry) subscribe to this protocol
    so that consumers can depend on the abstraction rather than the concrete
    NATS client.
    """

    @abstractmethod
    async def connect(self, servers: list[str] | None = None) -> None:
        """Connect to the message broker."""
        ...

    @abstractmethod
    async def emit(self, event: BaseEvent) -> None:
        """Publish a typed event to the bus."""
        ...

    @abstractmethod
    def on(self, event_class: Type[BaseEvent]) -> Callable[..., Any]:
        """Register a handler for an event class. Returns a decorator."""
        ...

    @abstractmethod
    async def start_subscriptions(self) -> None:
        """Start all registered subscriptions."""
        ...

    @abstractmethod
    async def drain(self) -> None:
        """Gracefully drain in-flight messages before closing."""
        ...
