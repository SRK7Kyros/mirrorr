"""Shared FastAPI dependencies: DB sessions, auth middleware, request state."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from dataclasses import dataclass
from typing import Any

from fastapi import Depends, HTTPException, Request, WebSocket
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer
from sqlmodel.ext.asyncio.session import AsyncSession

from mirrorr.storage.database import get_session_factory
from mirrorr.storage.models import Client, User

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
    from mirrorr.api.auth import resolve_client, resolve_user
    from mirrorr.api.jwt import decode_access_token

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
                from mirrorr.storage.enums import UserRole
                is_admin = user.role == UserRole.ADMIN
                # Reject access tokens issued before the last password change.
                # The JWT carries a "cv" (credentials_version) claim that must
                # match the user's current value — otherwise the token was
                # issued before the password was rotated and is now invalid.
                token_cv = payload.get("cv", 0)
                user_cv = getattr(user, "credentials_version", 0) or 0
                if token_cv != user_cv:
                    user = None  # token is stale — treat as unauthenticated
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
        from mirrorr.api.jwt import ACCESS_TOKEN_COOKIE
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


def _token_from_ws_protocols(header_value: str) -> str:
    for part in header_value.split(","):
        cand = part.strip().strip('"')
        if len(cand) > 20 and cand.count(".") == 2:
            return cand
    return ""


def pick_ws_subprotocol(websocket: WebSocket) -> str | None:
    try:
        offered = websocket.scope.get("subprotocols", [])
    except Exception:
        return None
    if not offered:
        header = websocket.headers.get("sec-websocket-protocol", "")
        offered = [p.strip() for p in header.split(",") if p.strip()]
    if not offered:
        return None
    token = _token_from_ws_protocols(", ".join(offered))
    return token or None


async def ws_auth(
    websocket: WebSocket,
) -> tuple[AuthState | None, str | None]:
    """Resolve auth from WebSocket connection.

    Auth sources (in priority order):
    1. ``mirrorr_access_token`` cookie (same-origin or lax-SameSite)
    2. ``X-API-Key`` header / ``?api_key=`` query param
    3. ``Authorization: Bearer <jwt>`` header
    4. JWT offered as a ``Sec-WebSocket-Protocol`` (browser/WS clients
       cannot set headers — the token rides the handshake instead)

    Note: ``?token=`` query parameter is intentionally NOT accepted —
    query strings are logged by proxies and leak via ``Referer``. Use
    cookies (browser SPA) or the ``Authorization`` header (API clients).
    """
    api_key = websocket.query_params.get("api_key", "") or websocket.headers.get("x-api-key", "")

    from mirrorr.api.jwt import ACCESS_TOKEN_COOKIE
    token = websocket.cookies.get(ACCESS_TOKEN_COOKIE, "")

    # Also check Authorization header (for non-browser clients)
    if not token:
        token = websocket.headers.get("authorization", "").removeprefix("Bearer ")

    # Native wrapper (Capacitor): browsers cannot set headers on the WS
    # handshake, so the client offers the JWT as a subprotocol instead.
    if not token:
        proto_header = websocket.headers.get("sec-websocket-protocol", "")
        token = _token_from_ws_protocols(proto_header)
    if not token:
        try:
            offered = websocket.scope.get("subprotocols", [])
            if offered:
                token = _token_from_ws_protocols(", ".join(offered))
        except Exception:
            pass

    async with get_session_factory()() as db:
        auth = await _resolve_auth(db, api_key, token)

    if not auth.client and not auth.user:
        return None, None

    return auth, None
