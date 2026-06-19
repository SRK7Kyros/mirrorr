"""Auth infrastructure: password hashing, user resolution, JWT validation."""

from __future__ import annotations

import hashlib

import bcrypt
from fastapi import HTTPException
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.storage.models import Client, User


# ── Password hashing ────────────────────────────────────────────────


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


# ── API key hashing ─────────────────────────────────────────────────


def hash_api_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


# ── Client resolution ───────────────────────────────────────────────


async def resolve_client(db: AsyncSession, api_key: str) -> Client:
    """Look up a client by API key hash. Raises 401 if invalid/inactive."""
    key_hash = hash_api_key(api_key)
    stmt = select(Client).where(Client.api_key_hash == key_hash, Client.is_active == True)  # noqa: E712
    result = await db.exec(stmt)
    client = result.first()
    if not client:
        raise HTTPException(status_code=401, detail="Invalid or inactive API key")
    return client


# ── User resolution ─────────────────────────────────────────────────


async def resolve_user(db: AsyncSession, username: str) -> User:
    """Look up a user by username. Raises 401 if not found."""
    stmt = select(User).where(User.username == username)
    result = await db.exec(stmt)
    user = result.first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return user


# ── Subscription helpers ────────────────────────────────────────────


async def subscribe_requester(
    db: AsyncSession,
    requester_user_token: str,
    resource_type: str,
    resource_id: int,
) -> None:
    """If the requester token is non-empty, create a subscription for the matching user."""
    if not requester_user_token:
        return
    stmt = select(User).where(User.username == requester_user_token)
    result = await db.exec(stmt)
    user = result.first()
    if not user:
        return

    from src.storage.models import EventSubscription
    sub_stmt = select(EventSubscription).where(
        EventSubscription.user_id == user.id,
        EventSubscription.resource_type == resource_type,
        EventSubscription.resource_id == resource_id,
    )
    sub_result = await db.exec(sub_stmt)
    if sub_result.first():
        return

    from datetime import datetime
    sub = EventSubscription(
        user_id=user.id,
        resource_type=resource_type,
        resource_id=resource_id,
        created_at=datetime.now(),
    )
    db.add(sub)
    await db.commit()


# ── Notification helpers ────────────────────────────────────────────


async def notify_subscribers(
    db: AsyncSession,
    resource_type: str,
    resource_id: int,
    event_type: str,
    title: str,
    body: str = "",
) -> int:
    """Create a Notification for every user subscribed to this resource."""
    from src.storage.models import EventSubscription, Notification

    stmt = select(EventSubscription).where(
        EventSubscription.resource_type == resource_type,
        EventSubscription.resource_id == resource_id,
    )
    result = await db.exec(stmt)
    subs = list(result.all())

    count = 0
    for sub in subs:
        dup_stmt = select(Notification).where(
            Notification.user_id == sub.user_id,
            Notification.resource_type == resource_type,
            Notification.resource_id == resource_id,
            Notification.event_type == event_type,
        )
        dup_result = await db.exec(dup_stmt)
        if dup_result.first():
            continue

        notif = Notification(
            user_id=sub.user_id,
            resource_type=resource_type,
            resource_id=resource_id,
            event_type=event_type,
            title=title,
            body=body,
        )
        db.add(notif)
        count += 1

    if count:
        await db.commit()
    return count
