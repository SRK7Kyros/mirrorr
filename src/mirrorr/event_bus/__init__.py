"""Event bus package — NATS-based messaging layer."""

from mirrorr.event_bus.event import MirrorrEvent
from mirrorr.event_bus.nats import bus

__all__ = ["bus", "MirrorrEvent"]

