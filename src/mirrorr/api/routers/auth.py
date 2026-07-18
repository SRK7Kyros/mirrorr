"""Auth CRUD: Registration, login, user management, notifications."""

from __future__ import annotations

import secrets
import threading
import time
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, Response, Request
from loguru import logger
from sqlalchemy.exc import IntegrityError
from sqlalchemy import text as sa_text
from sqlmodel import col as sa_col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from mirrorr.api.dependencies import _get_db_session, get_auth, require_auth, require_admin, AuthState
from mirrorr.api.auth import hash_api_key, hash_password_async, verify_password_async
from mirrorr.api.jwt import (
    create_access_token, create_refresh_token, decode_refresh_token,
    ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, ACCESS_TOKEN_EXPIRE_SECONDS,
    REFRESH_TOKEN_EXPIRE_SECONDS,
)
from mirrorr.api.schemas import (
    AuthResponse, ClientResponse, RegisterRequest, LoginRequest, RefreshRequest,
    ChangePasswordRequest, CreateClientRequest, UserResponse,
)
from mirrorr.storage.models import (
    Client, User, ClientUser, EventSubscription, Notification,
    RefreshTokenRecord,
)
from mirrorr.storage.enums import ResourceType
from mirrorr.storage import crud

auth_router = APIRouter(prefix="/auth")
notifications_router = APIRouter(prefix="/notifications")


# ── Cookie helpers ─────────────────────────────────────────────────


def _set_auth_cookies(
    response: Response,
    access_token: str,
    refresh_token: str,
    *,
    cookie_secure: bool = True,
    cookie_domain: str = "",
) -> None:
    """Set httpOnly secure cookies for access and refresh tokens."""
    common = dict(
        httponly=True,
        samesite="lax",
        secure=cookie_secure,
        domain=cookie_domain or None,
    )
    response.set_cookie(
        ACCESS_TOKEN_COOKIE, access_token,
        max_age=ACCESS_TOKEN_EXPIRE_SECONDS,
        path="/",
        **common,
    )
    response.set_cookie(
        REFRESH_TOKEN_COOKIE, refresh_token,
        max_age=REFRESH_TOKEN_EXPIRE_SECONDS,
        path="/",
        **common,
    )


def _clear_auth_cookies(response: Response, *, cookie_domain: str = "") -> None:
    """Clear auth cookies on logout."""
    common = dict(
        httponly=True,
        samesite="lax",
        path="/",
        domain=cookie_domain or None,
    )
    response.delete_cookie(ACCESS_TOKEN_COOKIE, **common)
    response.delete_cookie(REFRESH_TOKEN_COOKIE, **common)


# ── Rate limiting (simple in-memory, thread-safe) ──────────────────

_rate_limits: dict[str, list[float]] = {}
_rate_limits_lock = threading.Lock()

# Module-level settings reference — set during boot in core.py
_rate_limit_login: int = 10
_rate_limit_register: int = 5
_rate_limit_status: int = 30
_cookie_secure: bool = True
_cookie_domain: str = ""

def _client_ip(request: Request) -> str:
    """Return the originating client IP, honoring X-Forwarded-For from trusted proxies.

    Takes the first hop from X-Forwarded-For (if present), falling back to
    the direct connection's peer host. Used as the rate-limit key so limits
    work correctly behind reverse proxies (nginx, Caddy, etc.).
    """
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.client.host if request.client else "unknown"

def _check_rate_limit(key: str, max_attempts: int, window: float = 60.0) -> bool:
    """Check if a rate limit has been exceeded. Returns True if allowed.

    Thread-safe via a module-level lock. Note: this is per-process — under
    multiple uvicorn workers, each worker has its own counter, so the
    effective limit is ``N × max_attempts``. For production multi-worker
    deployments, replace with a shared store (Redis or SQLite-backed).
    """
    now = time.time()
    cutoff = now - window
    with _rate_limits_lock:
        entries = _rate_limits.get(key)
        if entries is None:
            entries = []
            _rate_limits[key] = entries
        entries[:] = [t for t in entries if t > cutoff]
        if len(entries) >= max_attempts:
            return False
        entries.append(now)

        # Periodic cleanup: if dict grows too large, prune stale keys
        if len(_rate_limits) > 10_000:
            stale_keys = [k for k, v in _rate_limits.items() if not v or v[-1] < cutoff]
            for k in stale_keys:
                del _rate_limits[k]

    return True


@auth_router.get("/status")
async def auth_status(
    request: Request,
    db: AsyncSession = Depends(_get_db_session),
):
    """Check if any users exist. Used by the register page to detect first-user setup.

    Rate-limited by IP to prevent user-existence enumeration. Returns a
    constant ``has_users: true`` after the first user exists (the only
    useful information for the bootstrap flow is "no users yet").
    """
    client_ip = _client_ip(request)
    if not _check_rate_limit(f"status:{client_ip}", max_attempts=_rate_limit_status):
        raise HTTPException(status_code=429, detail="Too many requests. Try again later.")
    result = await db.exec(select(User))
    has_users = len(list(result.all())) > 0
    return {"has_users": has_users}


# ── Registration & Login ────────────────────────────────────────────


@auth_router.post("/register", response_model=AuthResponse)
async def register(
    item: RegisterRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(_get_db_session),
    auth: AuthState = Depends(get_auth),
):
    """Register a new user. First user auto-becomes admin. Sets httpOnly cookies.

    The first-user check is atomic: we issue ``BEGIN IMMEDIATE`` to acquire
    a write lock before counting users, preventing the TOCTOU race where
    two concurrent unauthenticated registrations could both observe zero
    users and both create admin accounts.
    """
    # Rate limit check
    client_ip = _client_ip(request)
    if not _check_rate_limit(f"register:{client_ip}", max_attempts=_rate_limit_register):
        raise HTTPException(status_code=429, detail="Too many registration attempts. Try again later.")

    username = item.username.strip()
    password = item.password

    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password required")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    from mirrorr.storage.enums import UserRole

    # Atomic first-user check: use a nested transaction (savepoint) to
    # serialize concurrent registrations without raw BEGIN IMMEDIATE which
    # conflicts with SQLAlchemy's transaction management.
    is_first_user = False
    try:
        async with db.begin_nested():
            count_result = await db.exec(select(User))
            existing_users = list(count_result.all())
            is_first_user = len(existing_users) == 0

            if not is_first_user and not auth.is_admin:
                raise HTTPException(status_code=403, detail="Admin access required to create users")

            user = User(
                username=username,
                password_hash=await hash_password_async(password),
                role=UserRole.ADMIN if is_first_user else UserRole.USER,
                display_name=item.display_name or username,
            )
            db.add(user)
            await db.flush()

        await db.refresh(user)
    except IntegrityError:
        raise HTTPException(status_code=400, detail="Username already exists")
    except HTTPException:
        raise
    except Exception:
        await db.rollback()
        raise

    # Link to the current client
    if auth.client:
        link = ClientUser(client_id=auth.client.id, user_id=user.id)
        db.add(link)
        await db.commit()

    access_token = create_access_token({"username": user.username, "role": user.role})
    refresh_token = create_refresh_token({"username": user.username, "role": user.role})

    # Store refresh token JTI for revocation
    rt_payload = decode_refresh_token(refresh_token)
    if rt_payload and "jti" in rt_payload:
        exp_dt = datetime.fromtimestamp(rt_payload["exp"], tz=timezone.utc).replace(tzinfo=None)
        record = RefreshTokenRecord(
            jti=rt_payload["jti"],
            user_id=user.id,
            expires_at=exp_dt,
        )
        db.add(record)
        await db.commit()

    # Set httpOnly cookies
    _set_auth_cookies(
        response, access_token, refresh_token,
        cookie_secure=_cookie_secure,
        cookie_domain=_cookie_domain,
    )

    return AuthResponse(
        user=UserResponse(
            id=user.id,
            username=user.username,
            role=user.role,
            display_name=user.display_name,
        ),
    )


@auth_router.post("/login", response_model=AuthResponse)
async def login(
    item: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(_get_db_session),
):
    """Login with username + password. Sets httpOnly cookies for token pair."""
    # Rate limit check
    client_ip = _client_ip(request)
    if not _check_rate_limit(f"login:{client_ip}", max_attempts=_rate_limit_login):
        raise HTTPException(status_code=429, detail="Too many login attempts. Try again later.")

    username = item.username
    password = item.password

    stmt = select(User).where(User.username == username)
    result = await db.exec(stmt)
    user = result.first()

    if not user or not await verify_password_async(password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    access_token = create_access_token({"username": user.username, "role": user.role, "cv": user.credentials_version or 0})
    refresh_token = create_refresh_token({"username": user.username, "role": user.role})

    # Store refresh token JTI for revocation
    rt_payload = decode_refresh_token(refresh_token)
    if rt_payload and "jti" in rt_payload:
        exp_dt = datetime.fromtimestamp(rt_payload["exp"], tz=timezone.utc).replace(tzinfo=None)
        record = RefreshTokenRecord(
            jti=rt_payload["jti"],
            user_id=user.id,
            expires_at=exp_dt,
        )
        db.add(record)
        await db.commit()

    # Set httpOnly cookies
    _set_auth_cookies(
        response, access_token, refresh_token,
        cookie_secure=_cookie_secure,
        cookie_domain=_cookie_domain,
    )

    return AuthResponse(
        user=UserResponse(
            id=user.id,
            username=user.username,
            role=user.role,
            display_name=user.display_name,
        ),
    )


@auth_router.post("/logout")
async def logout(
    response: Response,
    request: Request,
    auth: AuthState = Depends(get_auth),
    db: AsyncSession = Depends(_get_db_session),
):
    """Logout: revoke refresh token and clear cookies."""
    # Revoke the current refresh token if present
    rt_str = request.cookies.get(REFRESH_TOKEN_COOKIE)
    if rt_str:
        payload = decode_refresh_token(rt_str)
        if payload and "jti" in payload:
            stmt = select(RefreshTokenRecord).where(RefreshTokenRecord.jti == payload["jti"])
            result = await db.exec(stmt)
            record = result.first()
            if record:
                record.revoked = True
                db.add(record)
                await db.commit()

    # Clear cookies
    _clear_auth_cookies(response)
    return {"status": "logged_out"}


@auth_router.get("/me", response_model=AuthResponse)
async def get_me(auth: AuthState = Depends(require_auth)):
    """Get current user info."""
    if auth.user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return AuthResponse(
        user=UserResponse(
            id=auth.user.id,
            username=auth.user.username,
            role=auth.user.role,
            display_name=auth.user.display_name,
        ),
        client=ClientResponse(id=auth.client.id, name=auth.client.name) if auth.client else None,
    )


@auth_router.post("/refresh", response_model=AuthResponse)
async def refresh(
    request: Request,
    response: Response,
    item: RefreshRequest | None = None,
    db: AsyncSession = Depends(_get_db_session),
):
    """Refresh an access token. Reads from httpOnly cookie or request body.

    On success, issues a new token pair (rotation) and revokes the old
    refresh token via JTI tracking.
    """
    # Accept refresh token from cookie or request body
    rt_str = None
    if item and item.refresh_token:
        rt_str = item.refresh_token
    else:
        rt_str = request.cookies.get(REFRESH_TOKEN_COOKIE)

    if not rt_str:
        raise HTTPException(status_code=400, detail="Refresh token required")

    payload = decode_refresh_token(rt_str)
    if not payload or "username" not in payload:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    # ── JTI revocation check ──────────────────────────────────────
    jti = payload.get("jti")
    if jti:
        stmt = select(RefreshTokenRecord).where(RefreshTokenRecord.jti == jti)
        result = await db.exec(stmt)
        record = result.first()
        if record and record.revoked:
            # This refresh token was already used — possible theft!
            # Revoke ALL tokens for this user as a precaution
            if record.user_id:
                from sqlmodel import update as sql_update
                await db.exec(
                    sql_update(RefreshTokenRecord)
                    .where(RefreshTokenRecord.user_id == record.user_id, RefreshTokenRecord.revoked == False)  # noqa: E712
                    .values(revoked=True)
                )
            raise HTTPException(status_code=401, detail="Refresh token already used — all sessions revoked")

        # Revoke the old token
        if record:
            record.revoked = True
            db.add(record)

    # Resolve user
    stmt = select(User).where(User.username == payload["username"])
    result = await db.exec(stmt)
    user = result.first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    # Issue new token pair (rotation)
    new_access = create_access_token({"username": user.username, "role": user.role, "cv": user.credentials_version or 0})
    new_refresh = create_refresh_token({"username": user.username, "role": user.role})

    # Store new refresh token JTI
    new_payload = decode_refresh_token(new_refresh)
    if new_payload and "jti" in new_payload:
        exp_dt = datetime.fromtimestamp(new_payload["exp"], tz=timezone.utc).replace(tzinfo=None)
        record = RefreshTokenRecord(
            jti=new_payload["jti"],
            user_id=user.id,
            expires_at=exp_dt,
        )
        db.add(record)

    # Single atomic commit for revoke + create
    await db.commit()

    # Best-effort cleanup of expired revoked tokens (keeps the table from
    # growing unbounded). Runs inline but is a single DELETE — cheap.
    # NOTE: this is a *separate* commit on purpose. The token rotation
    # above is already persisted; cleanup failure must never roll it back.
    # The try/except isolates cleanup errors from the caller's response.
    try:
        from sqlmodel import delete as sql_delete
        now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
        await db.exec(
            sql_delete(RefreshTokenRecord).where(
                RefreshTokenRecord.revoked == True,  # noqa: E712
                RefreshTokenRecord.expires_at < now_utc,
            )
        )
        await db.commit()
    except Exception as e:
        logger.debug(f"Expired token cleanup failed (non-fatal): {e}")

    # Set new httpOnly cookies
    _set_auth_cookies(
        response, new_access, new_refresh,
        cookie_secure=_cookie_secure,
        cookie_domain=_cookie_domain,
    )

    return AuthResponse(
        user=UserResponse(
            id=user.id,
            username=user.username,
            role=user.role,
            display_name=user.display_name,
        ),
    )


@auth_router.post("/change-password")
async def change_password(
    item: ChangePasswordRequest,
    db: AsyncSession = Depends(_get_db_session),
    auth: AuthState = Depends(require_auth),
):
    """Change current user's password and invalidate all refresh tokens."""
    old_password = item.old_password
    new_password = item.new_password

    if not auth.user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not await verify_password_async(old_password, auth.user.password_hash):
        raise HTTPException(status_code=400, detail="Invalid current password")

    auth.user.password_hash = await hash_password_async(new_password)
    # Bump credentials_version so existing access tokens are invalidated
    # immediately (not just refresh tokens). The JWT carries this claim
    # and is rejected in _resolve_auth if it doesn't match.
    auth.user.credentials_version = (auth.user.credentials_version or 0) + 1
    db.add(auth.user)

    # Invalidate all refresh tokens for this user (security best practice)
    from sqlmodel import update as sql_update
    await db.exec(
        sql_update(RefreshTokenRecord)
        .where(RefreshTokenRecord.user_id == auth.user.id, RefreshTokenRecord.revoked == False)  # noqa: E712
        .values(revoked=True)
    )

    await db.commit()

    return {"status": "password_changed"}


# ── User Management (Admin) ─────────────────────────────────────────


@auth_router.get("/users", response_model=list[UserResponse])
async def get_all_users(
    db: AsyncSession = Depends(_get_db_session),
    auth: AuthState = Depends(require_admin),
):
    """List all users. Admin only. Excludes password_hash from response."""
    users = await crud.get_all(db, User)
    return [
        UserResponse(
            id=u.id, username=u.username, role=u.role, display_name=u.display_name
        )
        for u in users
    ]


@auth_router.delete("/users/{username}")
async def delete_user(
    username: str,
    db: AsyncSession = Depends(_get_db_session),
    auth: AuthState = Depends(require_admin),
):
    """Delete a user. Admin only. Cannot delete the last admin."""
    from mirrorr.storage.enums import UserRole

    stmt = select(User).where(User.username == username)
    result = await db.exec(stmt)
    user = result.first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Prevent deleting the last admin user
    if user.role == UserRole.ADMIN:
        admin_count_result = await db.exec(
            select(User).where(User.role == UserRole.ADMIN)
        )
        admin_count = len(list(admin_count_result.all()))
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the last admin user")

    # Clean up related records — all in a single atomic commit
    from sqlmodel import delete as sql_delete
    try:
        # Bump credentials_version BEFORE deleting so any still-valid access
        # tokens for this user are rejected by the auth middleware.
        user.credentials_version = (user.credentials_version or 0) + 1
        db.add(user)

        await db.exec(sql_delete(ClientUser).where(sa_col(ClientUser.user_id) == user.id))
        await db.exec(sql_delete(EventSubscription).where(sa_col(EventSubscription.user_id) == user.id))
        await db.exec(sql_delete(Notification).where(sa_col(Notification.user_id) == user.id))
        await db.exec(sql_delete(RefreshTokenRecord).where(sa_col(RefreshTokenRecord.user_id) == user.id))
        await crud.delete(db, User, user.id)
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=500, detail="Failed to delete user and related records")
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
    item: CreateClientRequest,
    db: AsyncSession = Depends(_get_db_session),
    auth: AuthState = Depends(get_auth),
):
    """Create a client. Public for first client (bootstrapping), then admin only."""
    # Allow unauthenticated creation if no clients exist yet (bootstrap phase)
    if not auth.client:
        existing = await crud.get_all(db, Client)
        if existing:
            raise HTTPException(status_code=403, detail="Admin access required")
    elif not auth.is_admin:
        # Has API key but not admin — only admin can create additional clients
        raise HTTPException(status_code=403, detail="Admin access required")

    raw_key = secrets.token_urlsafe(32)
    client_data = {"name": item.name, "api_key_hash": hash_api_key(raw_key)}
    payload = Client.model_validate(client_data)
    try:
        obj = await crud.create(db, payload)
    except IntegrityError as e:
        raise HTTPException(status_code=400, detail="A resource with that name already exists.")

    return {"client": obj, "api_key": raw_key}


@auth_router.delete("/clients/{id}")
async def delete_client(
    id: int,
    db: AsyncSession = Depends(_get_db_session),
    auth: AuthState = Depends(require_admin),
):
    from sqlmodel import delete as sql_delete
    try:
        await db.exec(sql_delete(ClientUser).where(sa_col(ClientUser.client_id) == id))
        await crud.delete(db, Client, id)
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=500, detail="Failed to delete client and related records")
    return {"status": "deleted"}


# ── Notifications ────────────────────────────────────────────────────


@notifications_router.get("/")
async def get_my_notifications(
    auth: AuthState = Depends(require_auth),
    db: AsyncSession = Depends(_get_db_session),
):
    """Get notifications for the current user only."""
    if auth.user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
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
    if auth.user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
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
    if auth.user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
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
    if auth.user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
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
    if auth.user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    item = await crud.get_by_id(db, Notification, id)
    if not item or item.user_id != auth.user.id:
        raise HTTPException(status_code=404, detail="Notification not found")
    await crud.delete(db, Notification, id)
    return {"status": "deleted"}
