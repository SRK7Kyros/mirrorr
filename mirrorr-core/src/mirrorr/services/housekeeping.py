"""Reclaims content disk space: unowned directories, and recordings past the caps.

A session folder is created on disk before — and independently of — anything
the DB records about it, and remux moves a finished folder under
``recordings/``. A folder left behind by a crash, a kill, or a session row
deleted out from under it is debris nothing will ever read again. Recordings
are the other half: a scheduled capture writes gigabytes nobody is watching,
so the two retention caps are the one thing that keeps a season from filling
the disk.
"""

from __future__ import annotations

import asyncio
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path

from loguru import logger
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlmodel import select

from mirrorr.startup.config import MirrorrSettings
from mirrorr.services.session_lifecycle import remove_recording_folder
from mirrorr.storage.models import Recording, Session

# A folder exists for a moment before the supervisor records its path, so
# anything touched this recently is assumed to still be in flight.
_ORPHAN_MIN_AGE_SECONDS = 3600
_GB = 1024**3


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


def retention_doomed(
    rows: list[tuple[int, float, int]],
    max_gb: float,
    max_age_days: float,
    now: float,
) -> list[int]:
    """Ids of the recordings the caps push out, from ``(id, timestamp, bytes)`` rows.

    The archive keeps its newest recording whatever the caps say: a cap small
    enough to empty it is a misconfiguration, and a recording is the one thing
    here with no second copy.
    """
    if max_gb <= 0 and max_age_days <= 0:
        return []
    cutoff = now - max_age_days * 86400 if max_age_days > 0 else None
    budget = max_gb * _GB

    doomed: list[int] = []
    kept_bytes = 0.0
    for index, (recording_id, stamp, size) in enumerate(sorted(rows, key=lambda r: r[1], reverse=True)):
        too_old = cutoff is not None and stamp < cutoff
        too_big = budget > 0 and kept_bytes + size > budget
        if index and (too_old or too_big):
            doomed.append(recording_id)
        else:
            kept_bytes += size
    return list(reversed(doomed))


def _epoch(value: datetime) -> float:
    """A DB timestamp as epoch seconds — SQLite hands back a naive UTC datetime."""
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).timestamp()


async def prune_recordings(
    settings: MirrorrSettings,
    db_factory: async_sessionmaker,
    now: float | None = None,
) -> list[str]:
    """Delete the recordings past the retention caps; answer the names removed."""
    max_gb, max_age_days = settings.retention_max_gb, settings.retention_max_age_days
    if max_gb <= 0 and max_age_days <= 0:
        return []

    async with db_factory() as db:
        rows = {row.id: row for row in (await db.exec(select(Recording))).all()}
        doomed = retention_doomed(
            [(rid, _epoch(row.created_at), row.size_bytes or 0) for rid, row in rows.items()],
            max_gb,
            max_age_days,
            time.time() if now is None else now,
        )
        gone = [rows[rid] for rid in doomed]
        for row in gone:
            await db.delete(row)
        await db.commit()

    for row in gone:
        await remove_recording_folder(settings, row.disk_path)
        # A row the console is showing has just gone: without the event the
        # list keeps it until the next reload, and its player then 404s.
        try:
            from mirrorr.di import container
            from mirrorr.event_bus.event import MirrorrEvent

            await container.event_bus.emit(MirrorrEvent.RECORDING_DELETED(id=row.id))
        except Exception as e:
            logger.warning(f"Could not announce the retention delete of recording {row.id}: {e}")
    if gone:
        names = ", ".join(row.snake_case_name for row in gone)
        logger.info(f"Retention removed {len(gone)} recording(s): {names}")
    return [row.snake_case_name for row in gone]


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
            for sweep in (reap_orphan_session_dirs, prune_recordings):
                try:
                    await sweep(settings, db_factory)
                except Exception as e:
                    logger.error(f"Housekeeping {sweep.__name__} failed: {e}")
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=interval)
                break  # stop_event was set
            except asyncio.TimeoutError:
                pass  # normal — just means the interval elapsed
    finally:
        logger.info("Housekeeping stopped")
