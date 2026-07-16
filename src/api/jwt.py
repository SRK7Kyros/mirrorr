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

# Cookie names
ACCESS_TOKEN_COOKIE = "mirrorr_access_token"
REFRESH_TOKEN_COOKIE = "mirrorr_refresh_token"

# Module-level cached secret — generated once per process lifetime.
# Avoids the bug where each call to _get_secret_key() generated a new random key.
_cached_secret: str | None = None


def _get_secret_key(settings: MirrorrSettings | None = None) -> str:
    """Get JWT secret key. Caches the result for the process lifetime.

    Priority:
    1. Explicitly configured ``jwt_secret_key`` in settings
    2. ``MIRRORR_JWT_SECRET`` environment variable
    3. Auto-generated and persisted to ``<base_dir>/.jwt_secret``

    If auto-generated, a warning is logged advising the operator to set an
    explicit key for production use.
    """
    global _cached_secret
    if _cached_secret is not None:
        return _cached_secret

    if settings and settings.jwt_secret_key:
        _cached_secret = settings.jwt_secret_key
    else:
        import os
        _cached_secret = os.environ.get("MIRRORR_JWT_SECRET")

        if not _cached_secret:
            # Try to load a persisted secret to survive restarts
            if settings:
                secret_file = settings.base_dir / ".jwt_secret"
                try:
                    if secret_file.exists():
                        _cached_secret = secret_file.read_text().strip()
                except OSError:
                    pass

            if not _cached_secret:
                from loguru import logger
                _cached_secret = secrets.token_hex(32)
                logger.warning(
                    "JWT secret auto-generated — all existing tokens will be "
                    "invalidated on restart. Set JWT_SECRET_KEY in your .env or "
                    "environment for production use."
                )

                # Persist the generated secret so restarts don't invalidate tokens
                if settings:
                    secret_file = settings.base_dir / ".jwt_secret"
                    try:
                        secret_file.write_text(_cached_secret)
                    except OSError as e:
                        logger.warning(f"Could not persist JWT secret to {secret_file}: {e}")

    return _cached_secret


def _create_token(
    data: dict[str, Any],
    token_type: str,
    expires_delta: int,
    settings: MirrorrSettings | None = None,
    extra: dict[str, Any] | None = None,
) -> str:
    to_encode = data.copy()
    to_encode["exp"] = int(time.time()) + expires_delta
    to_encode["type"] = token_type
    if extra:
        to_encode.update(extra)
    secret_key = _get_secret_key(settings)
    return jwt.encode(to_encode, secret_key, algorithm=ALGORITHM)


def create_access_token(data: dict[str, Any], expires_delta: int = ACCESS_TOKEN_EXPIRE_SECONDS, settings: MirrorrSettings | None = None) -> str:
    return _create_token(data, "access", expires_delta, settings)


def create_refresh_token(data: dict[str, Any], expires_delta: int = REFRESH_TOKEN_EXPIRE_SECONDS, settings: MirrorrSettings | None = None) -> str:
    return _create_token(data, "refresh", expires_delta, settings, extra={"jti": secrets.token_hex(16)})


def decode_access_token(token: str, settings: MirrorrSettings | None = None) -> dict[str, Any] | None:
    """Decode and validate a JWT access token. Returns payload or None if invalid."""
    try:
        secret_key = _get_secret_key(settings)
        payload = jwt.decode(token, secret_key, algorithms=[ALGORITHM])
        if payload.get("type") != "access":
            return None
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
