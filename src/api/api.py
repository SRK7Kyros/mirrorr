import html
import time
from src.event_bus.nats import bus
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
from src.api.routers.crud import crud_routers, session_control_router
from src.api.routers.auth import auth_router, notifications_router
from src.api.routers.import_export import import_export_router
from src.api.ws import ws_router


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple in-memory rate limiter for sensitive endpoints.

    Tracks requests per IP and enforces limits on login/register
    to prevent brute-force attacks.
    """

    def __init__(self, app, login_limit: int = 20, register_limit: int = 10, window: float = 60.0):
        super().__init__(app)
        self.login_limit = login_limit
        self.register_limit = register_limit
        self.window = window
        self._requests: dict[str, list[float]] = {}

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if path not in ("/auth/login", "/auth/register"):
            return await call_next(request)

        client_ip = request.client.host if request.client else "unknown"
        limit = self.login_limit if path == "/auth/login" else self.register_limit
        key = f"{path}:{client_ip}"

        now = time.time()
        cutoff = now - self.window
        self._requests.setdefault(key, [])
        self._requests[key] = [t for t in self._requests[key] if t > cutoff]

        if len(self._requests[key]) >= limit:
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Please try again later."},
            )

        self._requests[key].append(now)
        return await call_next(request)


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
        ]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


# CORS is configured at boot time in core.py via setup_cors(app, origins)
# This is a development-only default; production must set CORS_ALLOWED_ORIGINS
setup_cors(API)

# Rate limiting middleware for auth endpoints
API.add_middleware(RateLimitMiddleware, login_limit=20, register_limit=10, window=60.0)

API.include_router(crud_routers)
API.include_router(session_control_router)
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
    entries = sorted(full_path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    rows = ""
    for entry in entries:
        name = entry.name + "/" if entry.is_dir() else entry.name
        href = path.rstrip("/") + "/" + name
        safe_name = html.escape(name)
        safe_href = html.escape(href, quote=True)
        size = f"{entry.stat().st_size:,} B" if entry.is_file() else "-"
        rows += f'<tr><td><a href="{safe_href}">{safe_name}</a></td><td>{size}</td></tr>\n'

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Index of {path}</title>
<style>
body {{ font-family: monospace; margin: 2em; background: #0b0b0b; color: #f2f2f2; }}
a {{ color: #7cc5ff; text-decoration: none; }} a:hover {{ text-decoration: underline; }}
td {{ padding: 2px 12px 2px 0; }}
</style></head><body>
<h2>Index of {path}</h2>
<table><tr><td><a href="{path.rstrip("/")}/../">..</a></td><td></td></tr>
{rows}</table>
</body></html>"""


class AutoIndexMiddleware(BaseHTTPMiddleware):
    """Intercepts directory requests under /content and returns autoindex."""

    def __init__(self, app, content_dir):
        super().__init__(app)
        self.content_dir = content_dir

    async def dispatch(self, request: Request, call_next):
        if not request.url.path.startswith("/content"):
            return await call_next(request)

        rel_path = request.url.path[len("/content"):].lstrip("/") or ""
        full_path = (self.content_dir / rel_path).resolve()

        # Path traversal guard
        if not str(full_path).startswith(str(self.content_dir.resolve())):
            return JSONResponse(status_code=403, content={"detail": "Forbidden"})

        if full_path.is_dir():
            display_path = "/content/" + rel_path
            return HTMLResponse(_directory_listing(display_path, full_path))

        return await call_next(request)


def mount_content(settings) -> None:
    """Mount content_dir as static files when dev_serve_files is enabled."""
    if settings.dev_serve_files:
        API.mount("/content", StaticFiles(directory=str(settings.content_dir)), name="content")
        API.add_middleware(AutoIndexMiddleware, content_dir=settings.content_dir)
