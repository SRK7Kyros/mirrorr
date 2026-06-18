from collections.abc import AsyncGenerator
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from src.storage.database import get_session_factory


async def _get_db_session() -> AsyncGenerator[AsyncSession, Any]:
    async with get_session_factory()() as session:
        yield session
