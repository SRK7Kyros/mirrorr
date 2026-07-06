from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from loguru import logger
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker as _async_sessionmaker, create_async_engine as _create_async_engine
from sqlmodel.ext.asyncio.session import AsyncSession as SQLModelAsyncSession

from src.startup.config import MirrorrSettings


# Module-level state — set once by MirrorrCore._boot().
_session_factory: _async_sessionmaker | None = None


def set_session_factory(factory: _async_sessionmaker) -> None:
    global _session_factory
    _session_factory = factory


def get_session_factory() -> _async_sessionmaker:
    if _session_factory is None:
        raise RuntimeError("Database not initialised. Call MirrorrCore._boot() first.")
    return _session_factory


@asynccontextmanager
async def get_session() -> AsyncGenerator[SQLModelAsyncSession, None]:
    """Standalone async context manager for DB sessions:

        async with get_session() as db:
            result = await db.exec(...)
    """
    async with get_session_factory()() as session:
        yield session


def create_db_engine(settings: MirrorrSettings) -> tuple[AsyncEngine, _async_sessionmaker]:
    """Create an async SQLAlchemy engine from MirrorrSettings.

    Returns:
        (engine, async_session_factory)
    """
    db_url = f"sqlite+aiosqlite:///{settings.db_file}"
    engine = _create_async_engine(
        url=db_url,
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine.sync_engine, "connect")
    def set_sqlite_pragma(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    session_factory = _async_sessionmaker(engine, class_=SQLModelAsyncSession, expire_on_commit=False)
    return engine, session_factory
