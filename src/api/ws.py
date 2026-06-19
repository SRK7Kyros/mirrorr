"""WebSocket endpoints: NATS event mirroring + real-time notification push."""

from __future__ import annotations

import json

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

    auth, _ = await ws_auth(websocket)

    subscribed_resources: set[tuple[str, int]] | None = None
    if auth and auth.user:
        subscribed_resources = await _get_subscribed_resources(auth.user.username)

    async def nats_event_handler(msg):
        try:
            if subscribed_resources is not None:
                subject = msg.subject
                if not _is_relevant_event(subject, subscribed_resources):
                    return
            await websocket.send_text(msg.data.decode())
        except Exception:
            pass

    sub = await bus.nc.subscribe(">", cb=nats_event_handler)

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await sub.unsubscribe()


@ws_router.websocket("/ws/notifications")
async def notifications_endpoint(websocket: WebSocket):
    """WebSocket that pushes real-time notifications to an authenticated user.

    Auth: pass ?token=JWT and/or X-API-Key header / ?api_key= query param.
    On connect, sends all unread notifications, then pushes new ones.
    """
    await websocket.accept()

    auth, _ = await ws_auth(websocket)
    if not auth or not auth.user:
        try:
            await websocket.close(code=4001, reason="Authentication required")
        except Exception:
            pass
        return

    user = auth.user

    # Send existing unread notifications
    async with get_session_factory()() as db:
        stmt = (
            select(Notification)
            .where(col(Notification.user_id) == user.id, Notification.read == False)  # type: ignore[arg-type]  # noqa: E712
            .order_by(col(Notification.created_at).desc())
        )
        result = await db.exec(stmt)
        unread = list(result.all())

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
        except Exception:
            return

    # Subscribe to NATS for new notifications
    subscribed_resources = await _get_subscribed_resources(user.username)

    async def notification_handler(msg):
        try:
            subject = msg.subject
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
        except Exception:
            pass

    sub = await bus.nc.subscribe(">", cb=notification_handler)

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await sub.unsubscribe()


# ── Internal helpers ─────────────────────────────────────────────────


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


def _is_relevant_event(subject: str, subscribed_resources: set[tuple[str, int]]) -> bool:
    """Check if a NATS subject matches any subscribed resource."""
    for resource_type, resource_id in subscribed_resources:
        prefix = f"{resource_type}.{resource_id}"
        if subject.startswith(prefix):
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
