"""JWT token creation and validation."""

from __future__ import annotations

import secrets
import time
from typing import Any

import jwt
from src.startup.config import MirrorrSettings

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_SECONDS = 3600 * 24  # 24 hours
REFRESH_TOKEN_EXPIRE_SECONDS = 7 * 24 * 3600  # 7 days

# Module-level cached secret — generated once per process lifetime.
# Avoids the bug where each call to _get_secret_key() generated a new random key.
_cached_secret: str | None = None


def _get_secret_key(settings: MirrorrSettings | None = None) -> str:
    """Get JWT secret key. Caches the result for the process lifetime."""
    global _cached_secret
    if _cached_secret is not None:
        return _cached_secret

    if settings and settings.jwt_secret_key:
        _cached_secret = settings.jwt_secret_key
    else:
        import os
        _cached_secret = os.environ.get("MIRRORR_JWT_SECRET") or secrets.token_hex(32)

    return _cached_secret


def create_access_token(data: dict[str, Any], expires_delta: int = ACCESS_TOKEN_EXPIRE_SECONDS, settings: MirrorrSettings | None = None) -> str:
    to_encode = data.copy()
    to_encode["exp"] = int(time.time()) + expires_delta
    to_encode["type"] = "access"
    secret_key = _get_secret_key(settings)
    return jwt.encode(to_encode, secret_key, algorithm=ALGORITHM)


def create_refresh_token(data: dict[str, Any], expires_delta: int = REFRESH_TOKEN_EXPIRE_SECONDS, settings: MirrorrSettings | None = None) -> str:
    to_encode = data.copy()
    to_encode["exp"] = int(time.time()) + expires_delta
    to_encode["type"] = "refresh"
    to_encode["jti"] = secrets.token_hex(16)
    secret_key = _get_secret_key(settings)
    return jwt.encode(to_encode, secret_key, algorithm=ALGORITHM)


def decode_access_token(token: str, settings: MirrorrSettings | None = None) -> dict[str, Any] | None:
    """Decode and validate a JWT token. Returns payload or None if invalid."""
    try:
        secret_key = _get_secret_key(settings)
        payload = jwt.decode(token, secret_key, algorithms=[ALGORITHM])
        return payload
    except jwt.InvalidTokenError:
        return None


def decode_refresh_token(token: str, settings: MirrorrSettings | None = None) -> dict[str, Any] | None:
    """Decode and validate a refresh token. Returns payload or None if invalid."""
    try:
        secret_key = _get_secret_key(settings)
        payload = jwt.decode(token, secret_key, algorithms=[ALGORITHM])
        if payload.get("type") != "refresh":
            return None
        return payload
    except jwt.InvalidTokenError:
        return None
