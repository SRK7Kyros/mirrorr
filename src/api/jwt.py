"""JWT token creation and validation."""

from __future__ import annotations

import secrets
import time
from typing import Any

import jwt

SECRET_KEY = "mirrorr-secret-change-in-production"  # TODO: make configurable
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_SECONDS = 3600 * 24  # 24 hours
REFRESH_TOKEN_EXPIRE_SECONDS = 7 * 24 * 3600  # 7 days


def create_access_token(data: dict[str, Any], expires_delta: int = ACCESS_TOKEN_EXPIRE_SECONDS) -> str:
    to_encode = data.copy()
    to_encode["exp"] = int(time.time()) + expires_delta
    to_encode["type"] = "access"
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(data: dict[str, Any], expires_delta: int = REFRESH_TOKEN_EXPIRE_SECONDS) -> str:
    to_encode = data.copy()
    to_encode["exp"] = int(time.time()) + expires_delta
    to_encode["type"] = "refresh"
    to_encode["jti"] = secrets.token_hex(16)
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any] | None:
    """Decode and validate a JWT token. Returns payload or None if invalid."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.InvalidTokenError:
        return None


def decode_refresh_token(token: str) -> dict[str, Any] | None:
    """Decode and validate a refresh token. Returns payload or None if invalid."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != "refresh":
            return None
        return payload
    except jwt.InvalidTokenError:
        return None
