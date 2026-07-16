"""Shared FastAPI dependencies: DB sessions, auth middleware, request state."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from dataclasses import dataclass
from typing import Any

from fastapi import Depends, HTTPException, Request, WebSocket
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer
from sqlmodel.ext.asyncio.session import AsyncSession

from src.storage.database import get_session_factory
from src.storage.models import Client, User

_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)
_bearer_scheme = HTTPBearer(auto_error=False)


# ── DB session ───────────────────────────────────────────────────────


async def _get_db_session() -> AsyncGenerator[AsyncSession, Any]:
    async with get_session_factory()() as session:
        yield session


# ── Request state for auth ───────────────────────────────────────────


@dataclass
class AuthState:
    """Populated by the auth dependency on validated requests."""
    client: Client | None = None
    user: User | None = None
    is_admin: bool = False


async def _resolve_auth(
    db: AsyncSession,
    api_key: str,
    token: str,
) -> AuthState:
    """Shared auth resolution logic for both HTTP and WebSocket contexts."""
    from src.api.auth import resolve_client, resolve_user
    from src.api.jwt import decode_access_token

    client = None
    user = None
    is_admin = False

    if api_key:
        try:
            client = await resolve_client(db, api_key)
        except HTTPException:
            pass

    if token:
        payload = decode_access_token(token)
        if payload and "username" in payload:
            try:
                user = await resolve_user(db, payload["username"])
                from src.storage.enums import UserRole
                is_admin = user.role == UserRole.ADMIN
            except HTTPException:
                pass

    return AuthState(client=client, user=user, is_admin=is_admin)


async def get_auth(
    request: Request,
    x_api_key: str | None = Depends(_api_key_header),
    bearer: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    db: AsyncSession = Depends(_get_db_session),
) -> AuthState:
    """FastAPI dependency: validate API key + JWT, resolve client + user.

    JWT is resolved from (in priority order):
    1. ``Authorization: Bearer`` header (backward compat, WS, API clients)
    2. ``mirrorr_access_token`` httpOnly cookie (browser SPA)
    """
    api_key = x_api_key or ""

    # Try Bearer header first, fall back to cookie
    token = bearer.credentials if bearer else ""
    if not token:
        from src.api.jwt import ACCESS_TOKEN_COOKIE
        token = request.cookies.get(ACCESS_TOKEN_COOKIE, "")

    return await _resolve_auth(db, api_key, token)


async def require_auth(
    auth: AuthState = Depends(get_auth),
) -> AuthState:
    """Requires a valid JWT token. API key is optional (app identity)."""
    if not auth.user:
        raise HTTPException(status_code=401, detail="JWT token required")
    return auth


async def require_admin(
    auth: AuthState = Depends(require_auth),
) -> AuthState:
    """Like require_auth but raises 403 if not admin."""
    if not auth.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return auth


# ── WebSocket auth ───────────────────────────────────────────────────


async def ws_auth(
    websocket: WebSocket,
) -> tuple[AuthState | None, str | None]:
    """Resolve auth from WebSocket connection.

    Auth sources (in priority order):
    1. ``?token=`` query parameter (backward compat)
    2. ``mirrorr_access_token`` cookie (same-origin or lax-SameSite)
    3. ``X-API-Key`` header / ``?api_key=`` query param
    """
    api_key = websocket.query_params.get("api_key", "") or websocket.headers.get("x-api-key", "")

    # Try query param first, then cookie
    token = websocket.query_params.get("token", "")
    if not token:
        from src.api.jwt import ACCESS_TOKEN_COOKIE
        token = websocket.cookies.get(ACCESS_TOKEN_COOKIE, "")

    # Also check Authorization header
    if not token:
        token = websocket.headers.get("authorization", "").removeprefix("Bearer ")

    async with get_session_factory()() as db:
        auth = await _resolve_auth(db, api_key, token)

    if not auth.client and not auth.user:
        return None, None

    return auth, None
