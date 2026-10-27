"""SQL for the console's search boxes.

The console ranks what it has loaded with ``rankBySearch``; a row that was never
paged in cannot be ranked, so a list may hand its term here instead. This is
deliberately a plain substring match over the names a card shows — the ranker
already decides which order those names deserve, and folding its token
admissions into SQL would leave the two disagreeing about what "matches".
"""

from __future__ import annotations

from sqlalchemy import or_
from sqlmodel import select

from mirrorr.storage.enums import SessionStatus
from mirrorr.storage.models import Engine, Profile, Recording, Resolver, Session

# The escape character for LIKE wildcards, so a term typing `100%` searches for
# that text rather than everything.
ESCAPE = "\\"


def like_pattern(raw: str | None) -> str | None:
    """A trimmed, lowercased LIKE pattern, or ``None`` when nothing was typed."""
    text = (raw or "").strip().lower()
    if not text:
        return None
    escaped = (
        text.replace(ESCAPE, ESCAPE * 2).replace("%", ESCAPE + "%").replace("_", ESCAPE + "_")
    )
    return f"%{escaped}%"


def _term(pattern: str) -> str:
    return pattern.strip("%")


def _contains(pattern: str, *columns) -> list:
    return [column.ilike(pattern, escape=ESCAPE) for column in columns]


def recording_predicate(pattern: str):
    """Rows whose own snapshot names (or id) contain *pattern*."""
    term = _term(pattern)
    parts = _contains(
        pattern,
        Recording.user_friendly_name,
        Recording.snake_case_name,
        Recording.profile_name,
        Recording.engine_name,
        Recording.resolver_name,
    )
    if term.isdigit():
        parts.append(Recording.id == int(term))
    return or_(*parts)


def session_predicate(pattern: str):
    """Rows whose profile, engine or resolver name, status or id contains *pattern*.

    A session carries no name of its own: what its card shows is the profile,
    engine and resolver it ran, so the match runs through those tables.
    """
    term = _term(pattern)
    parts = [
        Session.profile_id.in_(select(Profile.id).where(*_contains(pattern, Profile.name))),
        Session.engine_id.in_(select(Engine.id).where(*_contains(pattern, Engine.name))),
        Session.resolver_id.in_(select(Resolver.id).where(*_contains(pattern, Resolver.name))),
    ]
    statuses = [status for status in SessionStatus if term in status.value]
    if statuses:
        parts.append(Session.status.in_(statuses))
    if term.isdigit():
        parts.append(Session.id == int(term))
    return or_(*parts)
