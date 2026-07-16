"""Event bus package — NATS-based messaging layer."""

from src.event_bus.event import MirrorrEvent
from src.event_bus.nats import bus

__all__ = ["bus", "MirrorrEvent"]

