from __future__ import annotations

import asyncio
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from src.event_bus.nats import bus

ws_router = APIRouter()


@ws_router.websocket("/ws/events")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket that mirrors all NATS events and telemetry to the client.

    Subscribes to ``>`` (all NATS subjects) and forwards every message
    to the connected WebSocket. Clients can filter by subject prefix
    (e.g. ``session.{id}.telemetry``, ``session.started``).
    """
    await websocket.accept()

    async def nats_event_handler(msg):
        try:
            await websocket.send_text(msg.data.decode())
        except Exception:
            pass

    sub = await bus.nc.subscribe(">", cb=nats_event_handler)

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await sub.unsubscribe()
