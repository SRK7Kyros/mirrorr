"""JWT token creation and validation."""

from __future__ import annotations

import time
from typing import Any

import jwt

SECRET_KEY = "mirrorr-secret-change-in-production"  # TODO: make configurable
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_SECONDS = 3600 * 24  # 24 hours


def create_access_token(data: dict[str, Any], expires_delta: int = ACCESS_TOKEN_EXPIRE_SECONDS) -> str:
    to_encode = data.copy()
    to_encode["exp"] = int(time.time()) + expires_delta
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any] | None:
    """Decode and validate a JWT token. Returns payload or None if invalid."""
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.InvalidTokenError:
        return None
