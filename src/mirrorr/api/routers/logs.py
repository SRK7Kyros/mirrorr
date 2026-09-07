"""Session logs + recording progress endpoints.

Reads ``stdout``/``stderr`` log files written by :class:`ManagedProcess`
under the session's ``logs/`` directory, and exposes the latest remux
progress (the same structure the supervisor publishes to NATS on
``session.<id>.remux.progress``).
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from loguru import logger
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from mirrorr.api.dependencies import _get_db_session, require_auth, AuthState
from mirrorr.api.routers.crud import _require_owner_or_admin
from mirrorr.api.schemas import (
    SessionLogsResponse,
    RecordingProgressResponse,
)
from mirrorr.storage.models import Session

logs_router = APIRouter(prefix="/sessions")


def _require_user(auth: AuthState) -> None:
    if not auth.user:
        raise HTTPException(status_code=401, detail="Not authenticated")


async def _resolve_own_session(
    db: AsyncSession, session_id: int, auth: AuthState
) -> Session:
    """Load a session, enforcing ownership, or raise 404/403."""
    _require_user(auth)
    session = (await db.exec(select(Session).where(Session.id == session_id))).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    _require_owner_or_admin(auth, session)
    return session


@logs_router.get("/{session_id}/logs", response_model=SessionLogsResponse)
async def get_session_logs(
    session_id: int,
    auth: AuthState = Depends(require_auth),
    db: AsyncSession = Depends(_get_db_session),
    stream: str = Query(default="stdout", pattern="^(stdout|stderr)$"),
    name: str | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=500, ge=1, le=5000),
) -> SessionLogsResponse:
    """Tail a session's process output log file.

    Reads ``<session_folder>/logs/<name>.<stream>.log``. Returns up to
    ``limit`` lines starting at ``offset``; ``next_offset`` points past the
    returned lines so the client can poll incrementally (``eof`` True means
    the file is fully read).
    """
    session = await _resolve_own_session(db, session_id, auth)

    folder = getattr(session, "session_folder", None)
    if not folder:
        return SessionLogsResponse(session_id=session_id, stream=stream, name="", next_offset=offset, eof=True)
    logs_dir = Path(folder) / "logs"
    if not logs_dir.is_dir():
        return SessionLogsResponse(session_id=session_id, stream=stream, name="", next_offset=offset, eof=True)

    file = await _pick_log_file(logs_dir, stream, name)
    if file is None:
        return SessionLogsResponse(session_id=session_id, stream=stream, name=name or "", eof=True)

    lines, next_offset, eof = _read_tail(file, offset, limit)
    return SessionLogsResponse(
        session_id=session_id,
        stream=stream,
        name=file.stem.split(".")[0],
        lines=lines,
        next_offset=next_offset,
        eof=eof,
    )


@logs_router.get("/{session_id}/recording/progress", response_model=RecordingProgressResponse)
async def get_session_recording_progress(
    session_id: int,
    auth: AuthState = Depends(require_auth),
    db: AsyncSession = Depends(_get_db_session),
) -> RecordingProgressResponse:
    """Return the latest remux progress stored on the session."""
    session = await _resolve_own_session(db, session_id, auth)
    return RecordingProgressResponse(
        session_id=session_id,
        progress=session.recording_progress,
        status=session.status.value if hasattr(session.status, "value") else str(session.status),
    )


async def _pick_log_file(
    logs_dir: Path, stream: str, name: str | None
) -> Path | None:
    """Pick the most recent ``<name>.<stream>.log``, or the latest if unset."""

    def _scandir() -> Path | None:
        files = [p for p in logs_dir.glob(f"*.{stream}.log") if p.is_file()]
        if not files:
            return None
        if name:
            for p in files:
                if p.name.startswith(name + "."):
                    return p
        return max(files, key=lambda p: p.stat().st_mtime)

    return await asyncio.to_thread(_scandir)


def _read_tail(file: Path, offset: int, limit: int) -> tuple[list[str], int, bool]:
    """Read up to ``limit`` lines past ``offset`` (0-indexed, raw split lines).

    Returns ``(lines, next_offset, eof)``.
    """
    try:
        with open(file, "r", encoding="utf-8", errors="replace") as f:
            lines = f.read().splitlines()
    except OSError as e:
        logger.warning(f"Failed to read log file {file}: {e}")
        return [], offset, True

    start = min(offset, len(lines))
    chunk = lines[start : start + limit]
    next_offset = start + len(chunk)
    eof = next_offset >= len(lines)
    return chunk, next_offset, eof