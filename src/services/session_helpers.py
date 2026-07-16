"""Session helper functions extracted from session_supervisor.py.

These are pure utility functions that handle directory setup, URL building,
and DB session loading. They have no class state and are easier to test
in isolation.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from loguru import logger
from sqlmodel import select
from sqlalchemy.orm import selectinload

from src.storage.models import Session, Profile
from src.startup.config import MirrorrSettings


# ── Directory setup ───────────────────────────────────────────────────


async def make_session_dirs(
    session_folder: Path,
    logs_folder: Path,
    segments_folder: Path,
    settings: MirrorrSettings,
) -> None:
    """Create session directories and copy static assets."""
    session_folder.mkdir(parents=True, exist_ok=True)
    logs_folder.mkdir(parents=True, exist_ok=True)
    segments_folder.mkdir(parents=True, exist_ok=True)
    await copy_static_assets(session_folder, settings)


async def copy_static_assets(session_folder: Path, settings: MirrorrSettings) -> None:
    """Copy player/vlc/outplayer HTML into the session folder.

    Uses asyncio.to_thread for file I/O to avoid blocking the event loop.
    """
    import asyncio

    def _copy_files():
        from src.startup.config import _PACKAGE_ROOT
        static_dir = _PACKAGE_ROOT / "static_files"
        if not static_dir.exists():
            return
        for f in static_dir.glob("*.html"):
            dest = session_folder / f.name
            if not dest.exists():
                shutil.copy2(f, dest)

    await asyncio.to_thread(_copy_files)


def build_session_urls(
    session_folder: Path,
    segments_folder: Path,
    settings: MirrorrSettings,
) -> list[dict[str, str]]:
    """Build session_urls with label->URL pairs for the session folder."""
    web_url = settings.web_url.rstrip("/")
    if not web_url:
        return []

    try:
        rel = session_folder.relative_to(settings.content_dir)
    except ValueError:
        return []

    base = f"{web_url}/content/{rel.as_posix()}"
    urls: list[dict[str, str]] = []

    if (session_folder / "player.html").exists():
        urls.append({"label": "HTML", "url": f"{base}/player.html?src=stream.m3u8"})

    urls.append({"label": "M3U8", "url": f"{base}/stream.m3u8"})

    if (session_folder / "outplayer.html").exists():
        urls.append({"label": "Outplayer", "url": f"{base}/outplayer.html?src=stream.m3u8"})

    if (session_folder / "vlc.html").exists():
        urls.append({"label": "VLC", "url": f"{base}/vlc.html?src=stream.m3u8"})

    urls.append({"label": "Session", "url": base + "/"})
    return urls


# ── DB loading ────────────────────────────────────────────────────────


async def load_session_from_db(
    settings: MirrorrSettings,
    session_id: int,
) -> tuple[Session, "EngineInterface", "ResolverInterface"]:
    """Load the session from DB, JIT-load plugins, return components."""
    from src.plugins.interfaces import EngineInterface, ResolverInterface
    from src.storage.database import create_db_engine
    from src.startup.ensure_engines import load_engine_jit
    from src.startup.ensure_resolvers import load_resolver_jit

    engine, session_factory = create_db_engine(settings)
    try:
        async with session_factory() as db_session:
            stmt = (
                select(Session)
                .where(Session.id == session_id)
                .options(
                    selectinload(Session.engine),
                    selectinload(Session.resolver),
                    selectinload(Session.profile).selectinload(Profile.resolver),
                    selectinload(Session.autorun),
                )
            )
            result = await db_session.exec(stmt)
            session: Session | None = result.one_or_none()

            if session is None:
                raise ValueError(f"Session with id {session_id} not found")

            engine_interface = load_engine_jit(
                settings.engines_dir,
                session.engine.origin,
                session.engine.origin_hash,
            )

            # Use the session's own resolver when no profile is set
            resolver = session.profile.resolver if session.profile else session.resolver
            resolver_interface = load_resolver_jit(
                settings.resolvers_dir,
                resolver.origin,
                resolver.origin_hash,
            )
            return session, engine_interface, resolver_interface
    finally:
        await engine.dispose()
