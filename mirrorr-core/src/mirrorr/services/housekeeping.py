"""Reclaims content directories that no DB row owns any more.

A session folder is created on disk before — and independently of — anything
the DB records about it, and remux moves a finished folder under
``recordings/``. A folder left behind by a crash, a kill, or a session row
deleted out from under it is debris nothing will ever read again.
"""

from __future__ import annotations

import asyncio
import shutil
import time
from pathlib import Path

from loguru import logger
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlmodel import select

from mirrorr.startup.config import MirrorrSettings
from mirrorr.storage.models import Recording, Session

# A folder exists for a moment before the supervisor records its path, so
# anything touched this recently is assumed to still be in flight.
_ORPHAN_MIN_AGE_SECONDS = 3600


def _is_claimed(rel: Path, claimed: set[Path]) -> bool:
    """True when *rel* is claimed, or is an ancestor of something claimed."""
    return any(target == rel or rel in target.parents for target in claimed)


def sweep_orphans(
    content_dir: Path,
    claimed: set[Path],
    reserved: set[Path],
    min_age_seconds: float = _ORPHAN_MIN_AGE_SECONDS,
) -> list[str]:
    """Delete unclaimed directories under *content_dir*; return their paths.

    Only the top of an unclaimed subtree is removed — a directory holding a
    claimed descendant survives, which is what keeps ``recordings/`` around for
    as long as it holds a recording.
    """
    reaped: list[str] = []
    now = time.time()

    def walk(path: Path, rel: Path) -> bool:
        """Reap debris under *path*; return True when the directory survives."""
        if _is_claimed(rel, claimed):
            return True
        try:
            # Read the age first — removing children rewrites the parent's
            # mtime, which would make an old folder look brand new.
            age = now - path.stat().st_mtime
        except OSError:
            return True
        survived = False
        for child in sorted(path.iterdir()):
            if child.is_dir() and walk(child, rel / child.name):
                survived = True
        if survived or age < min_age_seconds:
            return True
        shutil.rmtree(path, ignore_errors=True)
        reaped.append(rel.as_posix())
        return False

    for entry in sorted(content_dir.iterdir()):
        if not entry.is_dir():
            continue
        rel = Path(entry.name)
        if entry in reserved:
            if not _is_claimed(rel, claimed):
                for child in sorted(entry.iterdir()):
                    if child.is_dir():
                        walk(child, rel / child.name)
        else:
            walk(entry, rel)
    # A reaped parent already took its children down with it.
    return [raw for raw in sorted(reaped) if not any(Path(top) in Path(raw).parents for top in reaped)]


async def reap_orphan_session_dirs(
    settings: MirrorrSettings,
    db_factory: async_sessionmaker,
) -> list[str]:
    """Reap every content folder no session or recording points at."""
    content_dir = settings.content_dir.resolve()
    if not content_dir.is_dir():
        return []

    async with db_factory() as db:
        folders = [folder for folder in (await db.exec(select(Session.session_folder))).all() if folder]
        recordings = list((await db.exec(select(Recording.disk_path))).all())

    claimed: set[Path] = set()
    for raw in [*folders, *recordings]:
        try:
            claimed.add(Path(raw).resolve().relative_to(content_dir))
        except (ValueError, OSError):
            continue  # outside the content dir — not ours to manage

    reserved = {settings.autoruns_dir.resolve(), settings.recordings_dir.resolve()}
    reaped = await asyncio.to_thread(sweep_orphans, content_dir, claimed, reserved)
    if reaped:
        logger.info(f"Reclaimed {len(reaped)} orphaned folder(s): {', '.join(reaped)}")
    return reaped


async def housekeeping_loop(
    settings: MirrorrSettings,
    db_factory: async_sessionmaker,
    stop_event: asyncio.Event,
) -> None:
    """Sweep for orphaned content folders every ``housekeeping_interval`` seconds."""
    interval = settings.housekeeping_interval
    logger.info(f"Housekeeping started (interval={interval}s)")
    try:
        while not stop_event.is_set():
            try:
                await reap_orphan_session_dirs(settings, db_factory)
            except Exception as e:
                logger.error(f"Housekeeping sweep failed: {e}")
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=interval)
                break  # stop_event was set
            except asyncio.TimeoutError:
                pass  # normal — just means the interval elapsed
    finally:
        logger.info("Housekeeping stopped")
