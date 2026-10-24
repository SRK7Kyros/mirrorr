from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker as _async_sessionmaker, create_async_engine as _create_async_engine
from sqlmodel.ext.asyncio.session import AsyncSession as SQLModelAsyncSession

from mirrorr.startup.config import MirrorrSettings


# Module-level state — set once by MirrorrCore._boot().
_db_factory: _async_sessionmaker | None = None


def set_db_factory(factory: _async_sessionmaker) -> None:
    global _db_factory
    _db_factory = factory


def get_db_factory() -> _async_sessionmaker:
    if _db_factory is None:
        raise RuntimeError("Database not initialised. Call MirrorrCore._boot() first.")
    return _db_factory


@asynccontextmanager
async def get_db() -> AsyncGenerator[SQLModelAsyncSession, None]:
    """Standalone async context manager for DB work:

        async with get_db() as db:
            result = await db.exec(...)
    """
    async with get_db_factory()() as db:
        yield db


def create_db_engine(settings: MirrorrSettings) -> tuple[AsyncEngine, _async_sessionmaker]:
    """Create an async SQLAlchemy engine from MirrorrSettings.

    Returns:
        (engine, db_factory)
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

    db_factory = _async_sessionmaker(engine, class_=SQLModelAsyncSession, expire_on_commit=False)
    return engine, db_factory
