"""The console's ops numbers.

What is running, what failed recently, what the recordings cost and when the
next schedule fires — one round trip for the strip above the sessions list and
the storage line above the recordings list. Every count is scoped by the same
access predicate the lists use, so a strip can never report a row its reader
may not open.
"""

from __future__ import annotations

import shutil
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import func, or_
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from mirrorr.storage.enums import AutorunStatus, SessionStatus
from mirrorr.storage.models import Autorun, Recording, Session

# The scope a caller may see, as a SQL boolean per model (see
# ``permissions.access_predicate``).
Scope = Callable[[type], Any]

# The sets mirror the console's own status vocabulary; a strip that disagreed
# with the filter chips beside it would read as a bug.
STARTING = (SessionStatus.INITIALIZING, SessionStatus.STREAM_PENDING)
LIVE = (SessionStatus.ACTIVE, SessionStatus.RECORDING, SessionStatus.TERMINATING)
FINISHING = (SessionStatus.REMUXING, SessionStatus.FINALIZING)
RUNNING = STARTING + LIVE + FINISHING

FAILED_WINDOW = timedelta(hours=24)


def _naive_now(now: datetime | None) -> datetime:
    """Naive UTC — the shape every timestamp in this database is stored in."""
    if now is None:
        return datetime.now(UTC).replace(tzinfo=None)
    return now.astimezone(UTC).replace(tzinfo=None) if now.tzinfo else now


async def _counts_by_status(db: AsyncSession, scope: Scope) -> dict[str, int]:
    stmt = select(Session.status, func.count()).where(scope(Session)).group_by(Session.status)
    rows = (await db.exec(stmt)).all()
    counts: dict[str, int] = {}
    for status, count in rows:
        key = status.value if isinstance(status, SessionStatus) else str(status)
        counts[key] = int(count)
    return counts


async def _failed_since(db: AsyncSession, scope: Scope, since: datetime) -> int:
    # A failed row may never have been stamped `ended_at` (it died before the
    # run settled), so its start is the fallback clock. A row that never got
    # either — it failed while being set up — is counted rather than hidden:
    # the strip exists to make a failure noticed, not to be exact about when.
    settled = func.coalesce(Session.ended_at, Session.started_at)
    stmt = (
        select(func.count())
        .select_from(Session)
        .where(
            scope(Session),
            Session.status == SessionStatus.FAILED,
            or_(settled >= since, settled.is_(None)),
        )
    )
    return int((await db.exec(stmt)).one())


async def _recordings(db: AsyncSession, scope: Scope) -> dict[str, int]:
    stmt = (
        select(
            func.count(),
            func.coalesce(func.sum(Recording.size_bytes), 0),
            func.coalesce(func.sum(Recording.duration_seconds), 0),
        )
        .select_from(Recording)
        .where(scope(Recording))
    )
    count, size_bytes, seconds = (await db.exec(stmt)).one()
    return {"count": int(count), "size_bytes": int(size_bytes), "seconds": int(seconds)}


async def _next_autorun(db: AsyncSession, scope: Scope, moment: datetime) -> dict[str, Any] | None:
    stmt = (
        select(Autorun)
        .where(
            scope(Autorun),
            Autorun.status == AutorunStatus.SCHEDULED,
            Autorun.start_time >= moment,
        )
        .order_by(Autorun.start_time)
        .limit(1)
    )
    rows = (await db.exec(stmt)).all()
    if not rows:
        return None
    row = rows[0]
    return {
        "id": row.id,
        "name": row.user_friendly_name,
        "starts_at": row.start_time,
        "status": row.status.value,
    }


def _disk(content_dir: Path | None) -> dict[str, int] | None:
    if content_dir is None:
        return None
    try:
        usage = shutil.disk_usage(content_dir)
    except OSError:
        return None
    return {"total_bytes": int(usage.total), "free_bytes": int(usage.free)}


async def summarise(
    db: AsyncSession,
    scope: Scope,
    *,
    content_dir: Path | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    moment = _naive_now(now)
    by_status = await _counts_by_status(db, scope)

    def in_set(statuses) -> int:
        return sum(by_status.get(status.value, 0) for status in statuses)

    return {
        "sessions": {
            "running": in_set(RUNNING),
            "live": in_set(LIVE),
            "starting": in_set(STARTING),
            "finishing": in_set(FINISHING),
            "failed_24h": await _failed_since(db, scope, moment - FAILED_WINDOW),
            "total": sum(by_status.values()),
        },
        "recordings": await _recordings(db, scope),
        "disk": _disk(content_dir),
        "next_autorun": await _next_autorun(db, scope, moment),
    }
