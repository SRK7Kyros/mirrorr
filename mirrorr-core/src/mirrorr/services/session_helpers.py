"""Session helper functions extracted from session_supervisor.py.

These are pure utility functions that handle directory setup, URL building,
and DB row loading. They have no class state and are easier to test
in isolation.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from sqlmodel import select
from sqlalchemy.orm import selectinload

from mirrorr.storage.models import Session, Profile, Engine, Resolver
from mirrorr.startup.config import MirrorrSettings


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
        from mirrorr.startup.config import _PACKAGE_ROOT
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
) -> tuple[Session, "EngineInterface", "ResolverInterface"]:  # ty: ignore[unresolved-reference] — runtime import inside function
    """Load the session from DB, JIT-load plugins, return components."""
    from mirrorr.plugin_api.interfaces import EngineInterface, ResolverInterface
    from mirrorr.storage.database import create_db_engine
    from mirrorr.startup.ensure_engines import load_engine_jit
    from mirrorr.startup.ensure_resolvers import load_resolver_jit

    engine, db_factory = create_db_engine(settings)
    try:
        async with db_factory() as db:
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
            result = await db.exec(stmt)
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


async def load_capture(settings: MirrorrSettings, spec: dict):
    """Load one capture's engine, resolver and the settings it runs with.

    ``spec`` is one capture of a run's plan — a profile taken whole, a resolver
    plus its config on an engine, or a rung of both. Any field it leaves as
    ``None`` is completed here: from the profile it names (a profile rung *is*
    that profile unless the rung overrides it), and otherwise from what the plan
    already carries. Returns ``(capture, engine, resolver)``; ``capture`` holds
    the names and config as JSON-ready values.
    """
    from mirrorr.storage.database import create_db_engine
    from mirrorr.startup.ensure_engines import load_engine_jit
    from mirrorr.startup.ensure_resolvers import load_resolver_jit

    profile_id = spec.get("profile_id")
    engine, db_factory = create_db_engine(settings)
    try:
        async with db_factory() as db:
            profile: Profile | None = None
            if profile_id is not None:
                stmt = (
                    select(Profile)
                    .where(Profile.id == profile_id)
                    .options(selectinload(Profile.resolver), selectinload(Profile.default_engine))
                )
                profile = (await db.exec(stmt)).one_or_none()
                if profile is None:
                    raise ValueError(f"Profile {profile_id} not found")

            engine_id = spec.get("engine_id")
            if engine_id is None and profile is not None:
                engine_id = profile.default_engine_id
            resolver_id = spec.get("resolver_id")
            if resolver_id is None and profile is not None:
                resolver_id = profile.resolver_id
            if engine_id is None or resolver_id is None:
                raise ValueError("This capture names neither a profile nor an engine + resolver")

            engine_row = await db.get(Engine, int(engine_id))
            if engine_row is None:
                raise ValueError(f"Engine {engine_id} not found")
            resolver = await db.get(Resolver, int(resolver_id))
            if resolver is None:
                raise ValueError(f"Resolver {resolver_id} not found")

            if spec.get("resolver_config") is not None:
                resolver_config = dict(spec["resolver_config"])
            elif profile is not None:
                resolver_config = dict(profile.resolver_config or {})
            else:
                resolver_config = {}
            retry_mode = spec.get("retry_mode")
            if retry_mode is None:
                retry_mode = profile.retry_mode if profile is not None else "none"
            retry_config = spec.get("retry_config")
            if retry_config is None:
                retry_config = dict(profile.retry_config or {}) if profile is not None else {}

            capture = {
                "profile_id": profile.id if profile is not None else None,
                "profile_name": profile.name if profile is not None else "",
                "source": "profile" if profile is not None else "resolver",
                "engine_name": engine_row.name,
                "resolver_name": resolver.name,
                "resolver_origin": resolver.origin,
                "resolver_hash": resolver.origin_hash,
                "resolver_config": resolver_config,
                "retry_mode": retry_mode,
                "retry_config": dict(retry_config or {}),
            }
            return (
                capture,
                load_engine_jit(settings.engines_dir, engine_row.origin, engine_row.origin_hash),
                load_resolver_jit(settings.resolvers_dir, resolver.origin, resolver.origin_hash),
            )
    finally:
        await engine.dispose()
