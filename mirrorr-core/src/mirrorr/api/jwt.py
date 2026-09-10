"""JWT token creation and validation."""

from __future__ import annotations

import os
import secrets
import sys
import threading
import time
from pathlib import Path
from typing import Any

import jwt
from mirrorr.startup.config import MirrorrSettings

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_SECONDS = 3600 * 24  # 24 hours
REFRESH_TOKEN_EXPIRE_SECONDS = 7 * 24 * 3600  # 7 days

# Cookie names
ACCESS_TOKEN_COOKIE = "mirrorr_access_token"
REFRESH_TOKEN_COOKIE = "mirrorr_refresh_token"

# Module-level cached secret — generated once per process lifetime.
# Avoids the bug where each call to _get_secret_key() generated a new random key.
_cached_secret: str | None = None
_secret_lock = threading.Lock()


def _restrict_file_permissions(path: Path) -> None:
    """Restrict a secret file to the current user only.

    On Unix, ``chmod 0o600`` is sufficient. On Windows, ``os.chmod`` only
    toggles the read-only flag and does NOT restrict ACLs — we use
    ``icacls`` to grant access only to the current user and remove
    inherited ACEs. Falls back to a best-effort ``os.chmod`` if ``icacls``
    is unavailable.
    """
    try:
        if sys.platform == "win32":
            import subprocess

            # Remove inheritance and copy current ACEs, then strip everyone but
            # the current user. "%username%" is expanded by cmd.exe.
            subprocess.run(
                [
                    "icacls", str(path),
                    "/inheritance:r",
                    "/grant:r", f"{os.getlogin()}:F",
                ],
                check=True,
                capture_output=True,
            )
        else:
            os.chmod(str(path), 0o600)
    except Exception as e:  # noqa: BLE001 — best-effort hardening, never fatal
        from loguru import logger
        logger.warning(
            f"Could not restrict permissions on JWT secret file {path}: {e}. "
            "Ensure the file is only readable by the Mirrorr process user."
        )


def _get_secret_key(settings: MirrorrSettings | None = None) -> str:
    """Get JWT secret key. Caches the result for the process lifetime.

    Priority:
    1. Explicitly configured ``jwt_secret_key`` in settings
    2. ``MIRRORR_JWT_SECRET`` environment variable
    3. Auto-generated and persisted to ``<base_dir>/.jwt_secret``

    In production (``MIRRORR_ENV != "development"``), auto-generation is
    forbidden — an explicit key must be configured. This prevents silent
    token invalidation on restart and ensures HA deployments share tokens.
    """
    global _cached_secret
    if _cached_secret is not None:
        return _cached_secret

    with _secret_lock:
        # Double-check after acquiring lock
        if _cached_secret is not None:
            return _cached_secret

        env = os.environ.get("MIRRORR_ENV", "development")

        if settings and settings.jwt_secret_key:
            _cached_secret = settings.jwt_secret_key
        else:
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
                    if env != "development":
                        raise RuntimeError(
                            "MIRRORR_JWT_SECRET (or settings.jwt_secret_key) must be "
                            "explicitly set in production. Generate one with:\n"
                            "  python -c 'import secrets; print(secrets.token_hex(32))'"
                        )

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
                            _restrict_file_permissions(secret_file)
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
