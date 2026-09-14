import asyncio
import html
import json
import time
from pathlib import Path
from mirrorr.event_bus.nats import bus
from loguru import logger
from fastapi import FastAPI, Request
from fastapi.concurrency import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import HTMLResponse, JSONResponse, Response
from starlette.routing import Mount
from mirrorr.api.routers.crud import crud_routers, session_control_router
from mirrorr.api.routers.auth import auth_router, notifications_router
from mirrorr.api.routers.import_export import import_export_router
from mirrorr.api.routers.logs import logs_router
from mirrorr.api.ws import ws_router





@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield


API = FastAPI(lifespan=lifespan, redirect_slashes=False)


@API.get("/favicon.ico")
async def favicon():
    return Response(status_code=204)


@API.get("/health")
async def health_check():
    """Dedicated health check endpoint for monitoring and load balancers."""
    return {"status": "ok"}


def setup_cors(app: FastAPI, allowed_origins: list[str] | None = None) -> None:
    """Configure CORS middleware with the given allowed origins.

    In production, allowed_origins should be set via CORS_ALLOWED_ORIGINS env var.
    If not configured, defaults to localhost origins for development.
    """
    if allowed_origins is None:
        allowed_origins = [
            "http://localhost:5173",  # Vite dev server
            "http://localhost:3000",  # Alternative dev port
            "http://localhost:8000",  # Backend API
            "http://127.0.0.1:5173",
            "http://127.0.0.1:3000",
            "http://127.0.0.1:8000",
            "capacitor://localhost",  # Capacitor wrapper (iOS + Android)
            "ionic://localhost",  # Ionic/Capacitor dev origin
        ]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


# ── Security hardening middleware ───────────────────────────────────

# Max bytes for any request body. Rejects oversized payloads (DoS protection).
MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024  # 10 MiB


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add standard security response headers to every response."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response


class RequestBodySizeLimitMiddleware(BaseHTTPMiddleware):
    """Reject requests whose Content-Length exceeds the configured limit.

    Streaming bodies without a Content-Length are checked as they arrive;
    a request that exceeds the limit mid-stream is aborted with 413.
    """

    def __init__(self, app, max_bytes: int = MAX_REQUEST_BODY_BYTES):
        super().__init__(app)
        self.max_bytes = max_bytes

    async def dispatch(self, request: Request, call_next):
        declared = request.headers.get("content-length")
        if declared is not None:
            try:
                if int(declared) > self.max_bytes:
                    return JSONResponse(
                        status_code=413,
                        content={"detail": "Request body too large."},
                    )
            except ValueError:
                return JSONResponse(
                    status_code=400,
                    content={"detail": "Invalid Content-Length header."},
                )
        return await call_next(request)


def setup_security_middleware(app: FastAPI) -> None:
    """Install security headers and request body size limit middlewares.

    Call once during application bootstrapping (after CORS is configured).
    """
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestBodySizeLimitMiddleware)


# ── HTTP request/response debug logging ─────────────────────────────

# Max body bytes captured per request/response line (truncation marker appended).
LOG_BODY_MAX_BYTES = 4 * 1024

# JSON keys whose values are replaced with "***" before logging.
_SENSITIVE_KEYS = frozenset({
    "password", "old_password", "new_password", "password_hash",
    "access_token", "refresh_token", "refresh-token", "token",
    "api_key", "api-key", "secret", "jwt_secret_key",
})

# Header names (lowercased) redacted from the log line.
_SENSITIVE_HEADERS = frozenset({"authorization", "x-api-key", "cookie", "set-cookie"})

# Singletons to avoid re-allocating the redacted body bytes every call.
_REDACTED = b"***"
_TRUNCATED_SUFFIX = b"...[truncated]"


def _redact_headers(headers) -> dict[str, str]:
    redacted: dict[str, str] = {}
    for key, value in headers.items():
        redacted[key] = "***" if key.lower() in _SENSITIVE_HEADERS else value
    return redacted


def _redact_body(raw: bytes) -> bytes:
    if not raw:
        return raw
    try:
        data = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        return raw[:LOG_BODY_MAX_BYTES] + (
            _TRUNCATED_SUFFIX if len(raw) > LOG_BODY_MAX_BYTES else b""
        )
    if isinstance(data, dict):
        data = {
            k: "***" if k.lower() in _SENSITIVE_KEYS else v
            for k, v in data.items()
        }
    encoded = json.dumps(data, default=str).encode()
    return encoded[:LOG_BODY_MAX_BYTES] + (
        _TRUNCATED_SUFFIX if len(encoded) > LOG_BODY_MAX_BYTES else b""
    )


class HttpDebugLoggingMiddleware(BaseHTTPMiddleware):
    """Log one line per request/response at DEBUG with redacted bodies.

    Installed only when ``LOG_HTTP_REQUESTS`` is enabled — never log bodies
    in production by default. Passwords, tokens, API keys and auth headers
    are replaced with ``***`` before anything reaches the log.
    """

    async def dispatch(self, request: Request, call_next):
        start = time.perf_counter()
        raw_request_body = await request.body()
        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - start) * 1000

        media_type = (response.headers.get("content-type", "").split(";")[0].strip() or "").lower()
        loggable = "json" in media_type or media_type.startswith("text/")
        if loggable:
            chunks: list[bytes] = []
            async for chunk in response.body_iterator:
                chunks.append(chunk)
            body = b"".join(chunks)
            res_body = _redact_body(body).decode(errors="replace")
            logged_response = Response(
                content=body,
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.media_type,
                background=response.background,
            )
        else:
            size = response.headers.get("content-length", "?")
            res_body = f"<{media_type or 'binary'} {size} bytes>"
            logged_response = response

        logger.debug(
            "{} {} -> {} ({:.1f}ms) req_headers={} req_body={} "
            "res_headers={} res_body={}".format(
                request.method,
                request.url.path,
                response.status_code,
                elapsed_ms,
                _redact_headers(request.headers),
                _redact_body(raw_request_body).decode(errors="replace"),
                _redact_headers(response.headers),
                res_body,
            )
        )
        return logged_response


def setup_http_debug_logging(app: FastAPI) -> None:
    app.add_middleware(HttpDebugLoggingMiddleware)


# CORS defaults are applied during _boot() in core.py.
# Do NOT configure CORS at module level — it would result in duplicate middlewares.
# If _boot() doesn't run (e.g., testing), the API has no CORS middleware.

API.include_router(crud_routers)
API.include_router(session_control_router)
API.include_router(logs_router)
API.include_router(auth_router)
API.include_router(notifications_router)
API.include_router(import_export_router)
API.include_router(ws_router)


@API.exception_handler(ValidationError)
async def validation_exception_handler(_request: Request, exc: ValidationError):
    return JSONResponse(
        status_code=422,
        content={"detail": "Invalid data format provided for update.", "errors": exc.errors()},
    )


@API.exception_handler(IntegrityError)
async def sqlalchemy_exception_handler(_request: Request, exc: IntegrityError):
    # Log the real error so it's not silently swallowed
    logger.error(f"IntegrityError: {exc.orig}")
    return JSONResponse(
        status_code=400,
        content={"detail": "A resource with that name already exists."},
    )


@API.exception_handler(Exception)
async def catch_all_exception_handler(_request: Request, exc: Exception):
    logger.exception(f"Unhandled exception: {exc}")
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


def _directory_listing(path: str, full_path) -> str:
    """Generate a simple HTML directory listing."""
    MAX_ENTRIES = 1000
    entries = sorted(full_path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    truncated = len(entries) > MAX_ENTRIES
    if truncated:
        entries = entries[:MAX_ENTRIES]
    rows = ""
    for entry in entries:
        name = entry.name + "/" if entry.is_dir() else entry.name
        href = path.rstrip("/") + "/" + name
        safe_name = html.escape(name)
        safe_href = html.escape(href, quote=True)
        try:
            size = f"{entry.stat().st_size:,} B" if entry.is_file() else "-"
        except OSError:
            size = "-"
        rows += f'<tr><td><a href="{safe_href}">{safe_name}</a></td><td>{size}</td></tr>\n'

    safe_path = html.escape(path)
    parent_href = html.escape(path.rstrip("/") + "/../", quote=True)
    truncation_note = f"<p><em>(showing first {MAX_ENTRIES} entries)</em></p>" if truncated else ""
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Index of {safe_path}</title>
<style>
body {{ font-family: monospace; margin: 2em; background: #0b0b0b; color: #f2f2f2; }}
a {{ color: #7cc5ff; text-decoration: none; }} a:hover {{ text-decoration: underline; }}
td {{ padding: 2px 12px 2px 0; }}
</style></head><body>
<h2>Index of {safe_path}</h2>
<table><tr><td><a href="{parent_href}">..</a></td><td></td></tr>
{rows}</table>
{truncation_note}
</body></html>"""


def _is_within_directory(child: Path, parent: Path) -> bool:
    """Path-traversal-safe check using pathlib relative_to.

    Returns True if ``child`` is equal to or nested under ``parent``.
    Both paths must be resolved (absolute) before calling.
    """
    try:
        child.relative_to(parent)
        return True
    except ValueError:
        return False


class AutoIndexMiddleware(BaseHTTPMiddleware):
    """Intercepts directory requests under /content and returns autoindex.

    Requires authentication: only authenticated users (or API-key clients)
    may browse the content directory. This prevents unauthenticated
    enumeration of session/recording metadata.
    """

    def __init__(self, app, content_dir):
        super().__init__(app)
        self.content_dir = content_dir.resolve()

    async def dispatch(self, request: Request, call_next):
        if not request.url.path.startswith("/content"):
            return await call_next(request)

        # Auth check — require an authenticated user or client.
        # AutoIndexMiddleware only runs when dev_serve_files is on (dev mode),
        # but we still don't want unauthenticated directory enumeration.
        from mirrorr.api.jwt import ACCESS_TOKEN_COOKIE
        from mirrorr.api.dependencies import _resolve_auth
        from mirrorr.storage.database import get_session_factory

        api_key = request.headers.get("x-api-key", "") or ""
        token = (
            request.headers.get("authorization", "").removeprefix("Bearer ")
            or request.cookies.get(ACCESS_TOKEN_COOKIE, "")
        )
        auth = None
        if api_key or token:
            try:
                async with get_session_factory()() as db:
                    auth = await _resolve_auth(db, api_key, token)
            except Exception:
                auth = None
        if not auth or (not auth.user and not auth.client):
            return JSONResponse(status_code=401, content={"detail": "Authentication required"})

        rel_path = request.url.path[len("/content"):].lstrip("/") or ""
        full_path = (self.content_dir / rel_path).resolve()

        # Path traversal guard (pathlib-safe, not string startswith)
        if not _is_within_directory(full_path, self.content_dir):
            return JSONResponse(status_code=403, content={"detail": "Forbidden"})

        if full_path.is_dir():
            display_path = "/content/" + rel_path
            # Directory listing does sync I/O — run in a thread to avoid
            # blocking the event loop on large directories.
            listing = await asyncio.to_thread(_directory_listing, display_path, full_path)
            return HTMLResponse(listing)

        return await call_next(request)


def mount_content(settings) -> None:
    """Mount content_dir as static files when dev_serve_files is enabled."""
    if settings.dev_serve_files:
        API.mount("/content", StaticFiles(directory=str(settings.content_dir)), name="content")
        API.add_middleware(AutoIndexMiddleware, content_dir=settings.content_dir)
