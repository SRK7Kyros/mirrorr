"""WebSocket endpoints: NATS event mirroring + real-time notification push.

Architecture (H3/H4 fix): a **shared relay** per endpoint type.

Instead of opening one NATS `">"` wildcard subscription per WebSocket
client (O(clients × messages) CPU + NATS fan-out cost), the process keeps
a single NATS subscription per endpoint type (`/ws/events`, `/ws/notifications`)
and fans each inbound NATS message out to all connected clients whose
subscription filter matches.

This drops the NATS subscription count from O(clients) to O(1) and removes
the per-event DB query that previously fetched the full `Notification` row
(H4): the relay forwards the NATS payload directly, falling back to a
synthetic notification shape when no DB row is embedded.

Unified notification contract (live relay + unread flush + REST rows share
one shape): ``{id|None, resource_type, resource_id, event_type, title,
body, read, created_at}``. Example live frame (no DB row embedded)::

    {"type": "notification", "data": {"id": None, "resource_type": "session",
     "resource_id": 7, "event_type": "session.started",
     "title": "session 7: session.started", "body": "", "read": False,
     "created_at": "2026-09-07T00:00:00"}}

Example flush/REST row (DB-backed, same keys, real id)::

    {"type": "notification", "data": {"id": 12, "resource_type": "session",
     "resource_id": 7, "event_type": "session.started",
     "title": "Session 7 started", "body": "", "read": False,
     "created_at": "2026-09-07T00:00:01"}}

Trade-off: a single relay subscription means one slow client can delay
fan-out to others. We mitigate by isolating each `send_text` in its own
task and pruning clients that fail. At Mirrorr's current scale (single
user, low event rate) this is far cheaper than the per-client model.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from loguru import logger
from sqlmodel import col, select

from mirrorr.event_bus.nats import bus
from mirrorr.api.dependencies import pick_ws_subprotocol, ws_auth
from mirrorr.storage.database import get_session_factory
from mirrorr.storage.models import EventSubscription, Notification

ws_router = APIRouter()


# ── Shared relay registries ───────────────────────────────────────────
# Each registry maps a connected WebSocket to its per-connection context
# (username, subscribed_resources, sent_count). A single NATS wildcard
# subscription fans messages out to every registered client.


class _ClientContext:
    """Per-connection state stored in a relay registry."""

    __slots__ = ("websocket", "username", "subscribed_resources", "sent_count")

    def __init__(
        self,
        websocket: WebSocket,
        username: str,
        subscribed_resources: set[tuple[str, int]] | None,
    ) -> None:
        self.websocket = websocket
        self.username = username
        self.subscribed_resources = subscribed_resources
        self.sent_count = 0


class _RelayRegistry:
    """Tracks connected WS clients for one endpoint type and owns the
    single shared NATS wildcard subscription that fans out to them."""

    def __init__(self, name: str) -> None:
        self.name = name
        self._clients: set[_ClientContext] = set()
        self._sub = None  # type: ignore[assignment]
        self._lock = asyncio.Lock()
        self._started = False

    async def register(self, ctx: _ClientContext) -> None:
        async with self._lock:
            self._clients.add(ctx)
            await self._ensure_subscription()

    async def unregister(self, ctx: _ClientContext) -> None:
        async with self._lock:
            self._clients.discard(ctx)

    async def _ensure_subscription(self) -> None:
        """Start the single shared NATS wildcard subscription on first client."""
        if self._started:
            return
        if not bus.nc or not bus.nc.is_connected:
            return
        self._started = True
        self._sub = await bus.nc.subscribe(">", cb=self._fanout)
        logger.debug(f"[{self.name}] shared NATS wildcard subscription active")

    async def _fanout(self, msg) -> None:
        """Single NATS callback — fans out to every matching client."""
        if _should_skip_subject(msg.subject):
            return
        # Snapshot under lock so iteration is safe from concurrent unregister.
        async with self._lock:
            clients = list(self._clients)
        if not clients:
            return
        # Build the per-endpoint payload once, then send to each client.
        # Both endpoints share the same filtering logic; the payload shape
        # differs and is computed by the per-endpoint handler below.
        await self._dispatch(msg, clients)

    async def _dispatch(self, msg, clients: list[_ClientContext]) -> None:
        """Endpoint-specific fan-out. Overridden by subclasses."""
        raise NotImplementedError


# ── /ws/events relay ─────────────────────────────────────────────────


class _EventsRelay(_RelayRegistry):
    async def _dispatch(self, msg, clients: list[_ClientContext]) -> None:
        subject = msg.subject
        try:
            payload = json.loads(msg.data.decode())
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            logger.warning(f"[ws/events] bad payload on {subject}: {e}")
            return
        payload["event"] = subject

        # Entity enrichment is shared across clients (same subject/id).
        entity_data: dict | None = None
        if subject not in ("session.deleted", "autorun.deleted",
                           "recording.deleted", "profile.deleted"):
            entity_id = payload.get("id")
            if entity_id is not None:
                entity_data = await _fetch_entity(subject, entity_id)
                if entity_data is not None:
                    payload["data"] = entity_data

        text = json.dumps(payload, default=str)

        async def _send(ctx: _ClientContext) -> None:
            if ctx.subscribed_resources is not None and not _is_relevant_event(
                subject, ctx.subscribed_resources
            ):
                return
            try:
                await ctx.websocket.send_text(text)
                ctx.sent_count += 1
            except Exception as e:
                # M9: log at warning (not silently drop) and prune the dead client.
                logger.warning(f"[ws/events] send failed for user={ctx.username}: {e}")
                await self.unregister(ctx)

        await asyncio.gather(*[_send(c) for c in clients], return_exceptions=True)


# ── /ws/notifications relay ──────────────────────────────────────────


class _NotificationsRelay(_RelayRegistry):
    async def _dispatch(self, msg, clients: list[_ClientContext]) -> None:
        subject = msg.subject
        try:
            data = json.loads(msg.data.decode())
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            logger.warning(f"[ws/notifications] bad payload on {subject}: {e}")
            return
        resource_type, resource_id = _parse_resource_from_subject(subject)
        if not resource_type:
            return
        event_type = subject
        # H4 fix: forward the NATS payload directly instead of opening a DB
        # session per event. Unified shape (matches flush + REST rows):
        # {id|None, resource_type, resource_id, event_type, title, body,
        #  read, created_at}. Handlers write real Notification rows via
        #  notify_subscribers; the emitter may embed the row as
        #  data["notification"] and we prefer it here.
        notif_payload: dict[str, Any] = {
            "id": None,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "event_type": event_type,
            "title": f"{resource_type} {resource_id}: {event_type}",
            "body": "",
            "read": False,
            "created_at": data.get("timestamp", ""),
        }
        # If the emitter included a full notification row, prefer it.
        embedded = data.get("notification")
        if isinstance(embedded, dict):
            notif_payload = {**notif_payload, **embedded}

        text = json.dumps({"type": "notification", "data": notif_payload})

        async def _send(ctx: _ClientContext) -> None:
            if ctx.subscribed_resources is not None and not _is_relevant_event(
                subject, ctx.subscribed_resources
            ):
                return
            try:
                await ctx.websocket.send_text(text)
                ctx.sent_count += 1
            except Exception as e:
                # M9: log at warning (not silently drop) and prune the dead client.
                logger.warning(f"[ws/notifications] send failed for user={ctx.username}: {e}")
                await self.unregister(ctx)

        await asyncio.gather(*[_send(c) for c in clients], return_exceptions=True)


_events_relay = _EventsRelay("ws/events")
_notifications_relay = _NotificationsRelay("ws/notifications")


@ws_router.websocket("/ws/events")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket that mirrors NATS events to the client.

    Auth: ``mirrorr_access_token`` cookie (browser SPA) or
    ``X-API-Key`` header / ``?api_key=`` query param (API clients) or
    ``Authorization: Bearer <jwt>`` header.
    If authenticated, events are filtered to only those matching the user's
    subscriptions. Unauthenticated connections receive all events.
    """
    subprotocol = pick_ws_subprotocol(websocket)
    if subprotocol:
        await websocket.accept(subprotocol=subprotocol)
    else:
        await websocket.accept()
    connected_at = time.monotonic()

    auth, _ = await ws_auth(websocket)
    if not auth or not auth.user:
        await websocket.close(code=4001, reason="Authentication required")
        return

    # Check NATS connection health before subscribing
    if not bus.nc or not bus.nc.is_connected:
        logger.warning(f"[ws/events] NATS not connected — rejecting connection for user={auth.user.username}")
        await websocket.close(code=1013, reason="Server temporarily unavailable")
        return

    username = auth.user.username
    logger.info(f"[ws/events] connected — user={username}")

    subscribed_resources = await _get_subscribed_resources(username)
    logger.debug(f"[ws/events] user={username} subscribed to {len(subscribed_resources)} resources")

    ctx = _ClientContext(websocket, username, subscribed_resources)
    await _events_relay.register(ctx)

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        elapsed = time.monotonic() - connected_at
        logger.info(f"[ws/events] disconnected — user={username}, duration={elapsed:.1f}s, events_sent={ctx.sent_count}")
    except Exception as e:
        elapsed = time.monotonic() - connected_at
        logger.error(f"[ws/events] error — user={username}, duration={elapsed:.1f}s: {e}")
    finally:
        await _events_relay.unregister(ctx)


@ws_router.websocket("/ws/notifications")
async def notifications_endpoint(websocket: WebSocket):
    """WebSocket that pushes real-time notifications to an authenticated user.

    Auth: pass ?token=JWT and/or X-API-Key header / ?api_key= query param.
    On connect, sends all unread notifications, then pushes new ones via the
    shared NATS relay.
    """
    subprotocol = pick_ws_subprotocol(websocket)
    if subprotocol:
        await websocket.accept(subprotocol=subprotocol)
    else:
        await websocket.accept()
    connected_at = time.monotonic()

    auth, _ = await ws_auth(websocket)
    if not auth or not auth.user:
        logger.warning("[ws/notifications] unauthenticated connection — closing")
        try:
            await websocket.close(code=4001, reason="Authentication required")
        except Exception:
            pass
        return

    # Check NATS connection health before subscribing
    if not bus.nc or not bus.nc.is_connected:
        logger.warning(f"[ws/notifications] NATS not connected — rejecting connection for user={auth.user.username}")
        try:
            await websocket.close(code=1013, reason="Server temporarily unavailable")
        except Exception:
            pass
        return

    user = auth.user
    logger.info(f"[ws/notifications] connected — user={user.username}")

    # Send existing unread notifications
    async with get_session_factory()() as db:
        stmt = (
            select(Notification)
            .where(col(Notification.user_id) == user.id, Notification.read == False)  # type: ignore[arg-type]  # noqa: E712
            .order_by(col(Notification.created_at).desc())
        )
        result = await db.exec(stmt)
        unread = list(result.all())

    logger.debug(f"[ws/notifications] user={user.username} has {len(unread)} unread notifications")
    async with get_session_factory()() as db:
        for notif in unread:
            try:
                await websocket.send_text(json.dumps({
                    "type": "notification",
                    "data": {
                        "id": notif.id,
                        "resource_type": notif.resource_type,
                        "resource_id": notif.resource_id,
                        "event_type": notif.event_type,
                        "title": notif.title,
                        "body": notif.body,
                        "read": False,
                        "created_at": notif.created_at.isoformat(),
                    },
                }))
                # Mark notification as read after successful send
                notif.read = True
                db.add(notif)
            except Exception as e:
                logger.warning(f"[ws/notifications] failed to send unread notif to user={user.username}: {e}")
                return
        await db.commit()

    subscribed_resources = await _get_subscribed_resources(user.username)
    logger.debug(f"[ws/notifications] user={user.username} subscribed to {len(subscribed_resources)} resources")

    ctx = _ClientContext(websocket, user.username, subscribed_resources)
    await _notifications_relay.register(ctx)

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        elapsed = time.monotonic() - connected_at
        logger.info(f"[ws/notifications] disconnected — user={user.username}, duration={elapsed:.1f}s, notifs_sent={ctx.sent_count}")
    except Exception as e:
        elapsed = time.monotonic() - connected_at
        logger.error(f"[ws/notifications] error — user={user.username}, duration={elapsed:.1f}s: {e}")
    finally:
        await _notifications_relay.unregister(ctx)


# ── Internal helpers ─────────────────────────────────────────────────


def _should_skip_subject(subject: str) -> bool:
    """Return True for NATS subjects that should never be forwarded to WS clients."""
    if ".telemetry." in subject:
        return True
    if subject.startswith("_INBOX."):
        return True
    if subject.endswith(".control"):
        return True
    return False


async def _get_subscribed_resources(
    username: str,
) -> set[tuple[str, int]]:
    """Return set of (resource_type, resource_id) tuples the user is subscribed to."""
    from mirrorr.storage.models import User

    async with get_session_factory()() as db:
        stmt = select(User.id).where(User.username == username)
        result = await db.exec(stmt)
        internal_id = result.first()

        if not internal_id:
            return set()

        stmt = select(EventSubscription.resource_type, EventSubscription.resource_id).where(
            EventSubscription.user_id == internal_id
        )
        result = await db.exec(stmt)
        return set(result.all())


_BROADCAST_PREFIXES = (
    "session.created", "session.updated", "session.deleted",
    "session.started", "session.stopped", "session.crashed",
    "autorun.created", "autorun.updated", "autorun.deleted",
    "recording.created", "recording.updated", "recording.deleted",
    "profile.created", "profile.updated", "profile.deleted",
)


def _is_relevant_event(subject: str, subscribed_resources: set[tuple[str, int]]) -> bool:
    """Check if a NATS subject should be forwarded to the client.

    Strategy:
    - Broadcast CRUD events are always relevant.
    - Per-resource events are only relevant when the user is subscribed.
    - Session control subjects are forwarded so the UI can observe commands.
    """
    if subject in _BROADCAST_PREFIXES:
        return True

    # Per-resource events — relevant if user is subscribed
    for resource_type, resource_id in subscribed_resources:
        if subject.startswith(f"{resource_type}.{resource_id}"):
            return True

    return False


def _parse_resource_from_subject(subject: str) -> tuple[str | None, int | None]:
    """Try to extract (resource_type, resource_id) from a NATS subject."""
    for rtype in ("session", "autorun", "recording", "profile"):
        if subject.startswith(f"{rtype}."):
            parts = subject.split(".")
            if len(parts) >= 2:
                try:
                    return rtype, int(parts[1])
                except ValueError:
                    pass
    return None, None


# ── Entity enrichment for zero-roundtrip updates ─────────────────────

_MODEL_MAP: dict[str, type] = {}

def _get_model_map() -> dict[str, type]:
    """Lazy import of SQLModel classes to avoid circular imports."""
    if not _MODEL_MAP:
        from mirrorr.storage.models import Session, Autorun, Recording, Profile
        _MODEL_MAP.update({
            "session": Session,
            "autorun": Autorun,
            "recording": Recording,
            "profile": Profile,
        })
    return _MODEL_MAP


async def _fetch_entity(subject: str, entity_id: int) -> dict | None:
    """Look up the full entity from the database for event enrichment.

    Returns a JSON-safe dict of the entity's fields, or ``None`` if the
    entity no longer exists (e.g. a race between delete and the WS relay).
    """
    # Extract the resource type from the first dot-separated segment.
    # Works for both broadcast subjects ("session.created") and
    # per-resource subjects ("session.5.telemetry").
    resource_type = subject.split(".")[0] if "." in subject else None
    if resource_type not in ("session", "autorun", "recording", "profile"):
        return None

    model_map = _get_model_map()
    model = model_map.get(resource_type)
    if model is None:
        return None

    try:
        async with get_session_factory()() as db:
            obj = await db.get(model, entity_id)
            if obj is None:
                return None
            # SQLModel.model_dump produces a plain dict; omit
            # relationship attributes to keep the payload lean.
            return obj.model_dump(mode="json")
    except Exception as e:
        logger.debug(f"[ws/events] enrichment failed for {subject} id={entity_id}: {e}")
        return None
