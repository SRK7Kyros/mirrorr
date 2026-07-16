"""WebSocket endpoints: NATS event mirroring + real-time notification push."""

from __future__ import annotations

import json
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from loguru import logger
from sqlmodel import col, select

from src.event_bus.nats import bus
from src.api.dependencies import ws_auth
from src.storage.database import get_session_factory
from src.storage.models import EventSubscription, Notification

ws_router = APIRouter()


@ws_router.websocket("/ws/events")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket that mirrors NATS events to the client.

    Auth: pass ?token=JWT and/or X-API-Key header / ?api_key= query param.
    If authenticated, events are filtered to only those matching the user's
    subscriptions. Unauthenticated connections receive all events.
    """
    await websocket.accept()
    connected_at = time.monotonic()

    auth, _ = await ws_auth(websocket)
    if not auth or not auth.user:
        await websocket.close(code=4001, reason="Authentication required")
        return
    username = auth.user.username if auth and auth.user else None
    logger.info(f"[ws/events] connected — user={username}")

    subscribed_resources: set[tuple[str, int]] | None = None
    if auth and auth.user:
        subscribed_resources = await _get_subscribed_resources(auth.user.username)
        logger.debug(f"[ws/events] user={username} subscribed to {len(subscribed_resources)} resources")

    sent_count = 0

    async def nats_event_handler(msg):
        nonlocal sent_count
        try:
            subject = msg.subject

            # Skip high-frequency telemetry — not useful for WS clients
            if _should_skip_subject(subject):
                return

            if subscribed_resources is not None:
                if not _is_relevant_event(subject, subscribed_resources):
                    logger.debug(f"[ws/events] filtered event for user={username}: {subject}")
                    return
            # Inject the NATS subject as the "event" field so the frontend
            # can map it to query keys (e.g. "autorun.updated" → ["autoruns"])
            payload = json.loads(msg.data.decode())
            payload["event"] = subject

            # Enrich the payload with the full entity so the frontend
            # can patch its React Query cache without a round-trip.
            if subject not in ("session.deleted", "autorun.deleted",
                               "recording.deleted", "profile.deleted"):
                entity_id = payload.get("id")
                if entity_id is not None:
                    entity_data = await _fetch_entity(subject, entity_id)
                    if entity_data is not None:
                        payload["data"] = entity_data

            await websocket.send_text(json.dumps(payload, default=str))
            sent_count += 1
            logger.debug(
                f"[ws/events] → user={username} event={subject} "
                f"id={payload.get('id')} total={sent_count}"
            )
        except Exception as e:
            logger.warning(f"[ws/events] send failed for user={username}: {e}")

    sub = await bus.nc.subscribe(">", cb=nats_event_handler)
    logger.debug(f"[ws/events] NATS wildcard subscription active for user={username}")

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        elapsed = time.monotonic() - connected_at
        logger.info(f"[ws/events] disconnected — user={username}, duration={elapsed:.1f}s, events_sent={sent_count}")
        await sub.unsubscribe()
    except Exception as e:
        elapsed = time.monotonic() - connected_at
        logger.error(f"[ws/events] error — user={username}, duration={elapsed:.1f}s: {e}")
        await sub.unsubscribe()


@ws_router.websocket("/ws/notifications")
async def notifications_endpoint(websocket: WebSocket):
    """WebSocket that pushes real-time notifications to an authenticated user.

    Auth: pass ?token=JWT and/or X-API-Key header / ?api_key= query param.
    On connect, sends all unread notifications, then pushes new ones.
    """
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
                    "created_at": notif.created_at.isoformat(),
                },
            }))
        except Exception as e:
            logger.warning(f"[ws/notifications] failed to send unread notif to user={user.username}: {e}")
            return

    # Subscribe to NATS for new notifications
    subscribed_resources = await _get_subscribed_resources(user.username)
    logger.debug(f"[ws/notifications] user={user.username} subscribed to {len(subscribed_resources)} resources")

    sent_count = 0

    async def notification_handler(msg):
        nonlocal sent_count
        try:
            subject = msg.subject
            if _should_skip_subject(subject):
                return
            if not _is_relevant_event(subject, subscribed_resources):
                return
            data = json.loads(msg.data.decode())
            event_type = subject
            resource_type, resource_id = _parse_resource_from_subject(subject)
            if not resource_type:
                return

            await websocket.send_text(json.dumps({
                "type": "notification",
                "data": {
                    "resource_type": resource_type,
                    "resource_id": resource_id,
                    "event_type": event_type,
                    "title": f"{resource_type} {resource_id}: {event_type}",
                    "created_at": data.get("timestamp", ""),
                },
            }))
            sent_count += 1
        except Exception as e:
            logger.warning(f"[ws/notifications] send failed for user={user.username}: {e}")

    sub = await bus.nc.subscribe(">", cb=notification_handler)

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        elapsed = time.monotonic() - connected_at
        logger.info(f"[ws/notifications] disconnected — user={user.username}, duration={elapsed:.1f}s, notifs_sent={sent_count}")
        await sub.unsubscribe()
    except Exception as e:
        elapsed = time.monotonic() - connected_at
        logger.error(f"[ws/notifications] error — user={user.username}, duration={elapsed:.1f}s: {e}")
        await sub.unsubscribe()


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
    from src.storage.models import User

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
        from src.storage.models import Session, Autorun, Recording, Profile
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
