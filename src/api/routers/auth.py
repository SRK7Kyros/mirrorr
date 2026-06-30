"""Auth CRUD: Registration, login, user management, notifications."""

from __future__ import annotations

import json
import secrets
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Body, Query
from sqlalchemy.exc import IntegrityError
from sqlmodel import col as sa_col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.api.dependencies import _get_db_session, get_auth, require_auth, require_admin, AuthState
from src.api.auth import hash_api_key, hash_password, verify_password
from src.api.jwt import create_access_token, create_refresh_token, decode_refresh_token
from src.storage.models import (
    Client, User, ClientUser, EventSubscription, Notification,
    ResourceType,
)
from src.storage import crud

auth_router = APIRouter(prefix="/auth")
notifications_router = APIRouter(prefix="/notifications")


@auth_router.get("/status")
async def auth_status(db: AsyncSession = Depends(_get_db_session)):
    """Check if any users exist. Used by the register page to detect first-user setup."""
    result = await db.exec(select(User))
    has_users = len(list(result.all())) > 0
    return {"has_users": has_users}


# ── Registration & Login ────────────────────────────────────────────


@auth_router.post("/register")
async def register(
    item: dict[str, Any] = Body(...),
    db: AsyncSession = Depends(_get_db_session),
    auth: AuthState = Depends(get_auth),
):
    """Register a new user. First user auto-becomes admin."""
    username = item.get("username", "").strip()
    password = item.get("password", "")

    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password required")
    if len(password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")

    # Check if this is the first user (auto-admin)
    count_stmt = select(User)
    count_result = await db.exec(count_stmt)
    is_first_user = len(list(count_result.all())) == 0

    if not is_first_user and not auth.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required to create users")

    user = User(
        username=username,
        password_hash=hash_password(password),
        role="admin" if is_first_user else item.get("role", "user"),
        display_name=item.get("display_name", username),
    )

    try:
        db.add(user)
        await db.commit()
        await db.refresh(user)
    except IntegrityError:
        raise HTTPException(status_code=400, detail="Username already exists")

    # Link to the current client
    if auth.client:
        link = ClientUser(client_id=auth.client.id, user_id=user.id)
        db.add(link)
        await db.commit()

    token = create_access_token({"username": user.username, "role": user.role})
    refresh_token = create_refresh_token({"username": user.username, "role": user.role})

    return {
        "user": {"id": user.id, "username": user.username, "role": user.role},
        "access_token": token,
        "refresh_token": refresh_token,
    }


@auth_router.post("/login")
async def login(
    item: dict[str, Any] = Body(...),
    db: AsyncSession = Depends(_get_db_session),
):
    """Login with username + password. Requires API key header."""
    username = item.get("username", "")
    password = item.get("password", "")

    stmt = select(User).where(User.username == username)
    result = await db.exec(stmt)
    user = result.first()

    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token({"username": user.username, "role": user.role})
    refresh_token = create_refresh_token({"username": user.username, "role": user.role})

    return {
        "user": {"id": user.id, "username": user.username, "role": user.role},
        "access_token": token,
        "refresh_token": refresh_token,
    }


@auth_router.get("/me")
async def get_me(auth: AuthState = Depends(require_auth)):
    """Get current user info."""
    assert auth.user is not None
    return {
        "user": {
            "id": auth.user.id,
            "username": auth.user.username,
            "role": auth.user.role,
            "display_name": auth.user.display_name,
        },
        "client": {
            "id": auth.client.id,
            "name": auth.client.name,
        } if auth.client else None,
    }


@auth_router.post("/refresh")
async def refresh(
    item: dict[str, Any] = Body(...),
    db: AsyncSession = Depends(_get_db_session),
):
    """Refresh an access token using a refresh token."""
    rt_str = item.get("refresh_token", "")
    if not rt_str:
        raise HTTPException(status_code=400, detail="Refresh token required")

    payload = decode_refresh_token(rt_str)
    if not payload or "username" not in payload:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    # Resolve user
    stmt = select(User).where(User.username == payload["username"])
    result = await db.exec(stmt)
    user = result.first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    # Issue new token pair (rotation)
    new_access = create_access_token({"username": user.username, "role": user.role})
    new_refresh = create_refresh_token({"username": user.username, "role": user.role})

    return {
        "access_token": new_access,
        "refresh_token": new_refresh,
    }


@auth_router.post("/change-password")
async def change_password(
    item: dict[str, Any] = Body(...),
    db: AsyncSession = Depends(_get_db_session),
    auth: AuthState = Depends(require_auth),
):
    """Change current user's password."""
    old_password = item.get("old_password", "")
    new_password = item.get("new_password", "")

    if not auth.user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not verify_password(old_password, auth.user.password_hash):
        raise HTTPException(status_code=400, detail="Invalid current password")

    auth.user.password_hash = hash_password(new_password)
    db.add(auth.user)
    await db.commit()

    return {"status": "password_changed"}


# ── User Management (Admin) ─────────────────────────────────────────


@auth_router.get("/users")
async def get_all_users(
    db: AsyncSession = Depends(_get_db_session),
    auth: AuthState = Depends(require_admin),
):
    """List all users. Admin only."""
    return await crud.get_all(db, User)


@auth_router.delete("/users/{username}")
async def delete_user(
    username: str,
    db: AsyncSession = Depends(_get_db_session),
    auth: AuthState = Depends(require_admin),
):
    """Delete a user. Admin only."""
    stmt = select(User).where(User.username == username)
    result = await db.exec(stmt)
    user = result.first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Clean up related records
    from sqlmodel import delete as sql_delete
    await db.exec(sql_delete(ClientUser).where(sa_col(ClientUser.user_id) == user.id))
    await db.exec(sql_delete(EventSubscription).where(sa_col(EventSubscription.user_id) == user.id))
    await db.exec(sql_delete(Notification).where(sa_col(Notification.user_id) == user.id))
    await db.commit()
    await crud.delete(db, User, user.id)
    return {"status": "deleted", "username": username}


# ── Client Management ───────────────────────────────────────────────


@auth_router.get("/clients")
async def get_all_clients(
    db: AsyncSession = Depends(_get_db_session),
    auth: AuthState = Depends(require_admin),
):
    return await crud.get_all(db, Client)


@auth_router.post("/clients")
async def create_client(
    item: dict[str, Any] = Body(...),
    db: AsyncSession = Depends(_get_db_session),
    auth: AuthState = Depends(get_auth),
):
    """Create a client. Public for first client (bootstrapping), then admin only."""
    # Allow unauthenticated creation if no clients exist yet,
    # or if the requesting client is not authenticated (bootstrap phase)
    if not auth.client:
        # No API key provided — check if we can bootstrap
        existing = await crud.get_all(db, Client)
        if existing:
            raise HTTPException(status_code=403, detail="Admin access required")
    elif not auth.is_admin:
        # Has API key but not admin — check if any clients exist
        existing = await crud.get_all(db, Client)
        if len(existing) > 1:  # more than just the requesting client
            raise HTTPException(status_code=403, detail="Admin access required")

    raw_key = secrets.token_urlsafe(32)
    item["api_key_hash"] = hash_api_key(raw_key)
    payload = Client.model_validate_json(json.dumps(item))
    try:
        obj = await crud.create(db, payload)
    except IntegrityError as e:
        raise HTTPException(status_code=400, detail=f"Database integrity error: {e.orig}")

    return {"client": obj, "api_key": raw_key}


@auth_router.delete("/clients/{id}")
async def delete_client(
    id: int,
    db: AsyncSession = Depends(_get_db_session),
    auth: AuthState = Depends(require_admin),
):
    from sqlmodel import delete as sql_delete
    await db.exec(sql_delete(ClientUser).where(sa_col(ClientUser.client_id) == id))
    await db.commit()
    await crud.delete(db, Client, id)


# ── Notifications ────────────────────────────────────────────────────


@notifications_router.get("/")
async def get_my_notifications(
    auth: AuthState = Depends(require_auth),
    db: AsyncSession = Depends(_get_db_session),
):
    """Get notifications for the current user only."""
    assert auth.user is not None
    stmt = (
        select(Notification)
        .where(sa_col(Notification.user_id) == auth.user.id)
        .order_by(sa_col(Notification.created_at).desc())
    )
    result = await db.exec(stmt)
    return list(result.all())


@notifications_router.get("/{id}")
async def get_notification(
    id: int,
    auth: AuthState = Depends(require_auth),
    db: AsyncSession = Depends(_get_db_session),
):
    assert auth.user is not None
    item = await crud.get_by_id(db, Notification, id)
    if not item or item.user_id != auth.user.id:
        raise HTTPException(status_code=404, detail="Notification not found")
    return item


@notifications_router.post("/{id}/read")
async def mark_notification_read(
    id: int,
    auth: AuthState = Depends(require_auth),
    db: AsyncSession = Depends(_get_db_session),
):
    assert auth.user is not None
    item = await crud.get_by_id(db, Notification, id)
    if not item or item.user_id != auth.user.id:
        raise HTTPException(status_code=404, detail="Notification not found")
    item.read = True
    db.add(item)
    await db.commit()
    return item


@notifications_router.post("/read-all")
async def mark_all_read(
    auth: AuthState = Depends(require_auth),
    db: AsyncSession = Depends(_get_db_session),
):
    assert auth.user is not None
    from sqlmodel import update as sql_update
    await db.exec(
        sql_update(Notification)
        .where(sa_col(Notification.user_id) == auth.user.id)  # type: ignore[arg-type]
        .where(sa_col(Notification.read) == False)  # noqa: E712
        .values(read=True)
    )
    await db.commit()
    return {"status": "all_marked_read"}


@notifications_router.delete("/{id}")
async def delete_notification(
    id: int,
    auth: AuthState = Depends(require_auth),
    db: AsyncSession = Depends(_get_db_session),
):
    assert auth.user is not None
    item = await crud.get_by_id(db, Notification, id)
    if not item or item.user_id != auth.user.id:
        raise HTTPException(status_code=404, detail="Notification not found")
    await crud.delete(db, Notification, id)
    return {"status": "deleted"}
