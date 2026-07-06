from __future__ import annotations

from collections.abc import Callable
from loguru import logger
import asyncio
import json
from typing import Any, Awaitable, Type, TypeVar
from nats.aio.client import Client as NATS
from src.event_bus.event import BaseEvent, MirrorrEvent, T
from src.event_bus.protocol import EventBus


class NatsRegistry(EventBus):
    def __init__(self) -> None:
        self.nc = NATS()
        self._handlers: dict[str, list[tuple[Callable[..., Awaitable[None]], Type[BaseEvent]]]] = {}
        self._settings: "MirrorrSettings | None" = None  # Set by MirrorrCore at boot

    async def connect(self, servers: list[str] | None = None) -> None:
        if servers is None:
            servers = ["nats://localhost:4222"]
        await self.nc.connect(servers=servers)

    async def emit(self, event: BaseEvent) -> None:
        """Publishes a fully typed event to the NATS server."""
        data_bytes = event.model_dump_json().encode()
        await self.nc.publish(event.subject, data_bytes)

    def on(self, event_class: Type[BaseEvent]):
        """Registers a callback for an event."""
        def decorator(func: Callable[[T], Awaitable[None]]):
            subject = event_class.subject
            if subject not in self._handlers:
                self._handlers[subject] = []
            self._handlers[subject].append((func, event_class))
            return func
        return decorator

    async def start_subscriptions(self) -> None:
        logger.info("Registering subscriptions for the event bus...")
        for subject, handlers in self._handlers.items():
            handler_names = ", ".join(
                [f"<green>{handler_func.__name__}</green>" for handler_func, _ in handlers]  # ty:ignore[unresolved-attribute]
            )
            logger.opt(colors=True).info(
                f"Registering {len(handlers)} subscriptions for <blue>{subject}</blue>. "
                f"Subs: {handler_names}"
            )

            async def wrap(msg, handlers=handlers, subject=subject):
                raw_json = json.loads(msg.data.decode())
                tasks = []
                for handler_func, schema in handlers:
                    try:
                        instance = schema.model_validate(raw_json)
                        tasks.append(handler_func(instance))
                    except Exception as e:
                        logger.opt(colors=True).error(
                            f"Validation error for <blue>{subject}</blue>: {e}"
                        )
                if tasks:
                    await asyncio.gather(*tasks)

            try:
                await self.nc.subscribe(subject, cb=wrap)
            except Exception as e:
                logger.error(f"Failed to register subscription for <blue>{subject}</blue>: {e}")
        logger.info("Subscriptions registered successfully.")

    async def drain(self) -> None:
        """Gracefully drain in-flight NATS messages before closing."""
        try:
            await self.nc.drain()
        except Exception as e:
            logger.debug(f"NATS drain error (non-fatal): {e}")

    def get_handlers(self, event: Type[BaseEvent]) -> list[tuple[Callable[..., Awaitable[None]], Type[BaseEvent]]]:
        return self._handlers.get(event.subject, [])


bus = NatsRegistry()


# ── Dedicated control connection ───────────────────────────────────────
# bus.nc has a ">" wildcard subscription (WS events handler) that
# intercepts inbox replies before request() futures can resolve.
# We use a separate, subscription-free connection for request/reply
# control commands to supervisor processes.

_control_nc: NATS | None = None


async def get_control_nc() -> NATS:
    """Return (and lazily create) a dedicated NATS connection for control requests."""
    global _control_nc
    if _control_nc is None or not _control_nc.is_connected:
        _control_nc = NATS()
        await _control_nc.connect(bus._settings.nats_url)
    return _control_nc


async def drain_control_nc() -> None:
    """Gracefully close the dedicated control connection (called on shutdown)."""
    global _control_nc
    if _control_nc is not None:
        try:
            await _control_nc.drain()
        except Exception:
            pass
        _control_nc = None
