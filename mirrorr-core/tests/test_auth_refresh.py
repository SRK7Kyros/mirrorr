"""A refresh with no token is an expired session, not a bad request.

The console answers `401` from `/auth/refresh` by forcing the logout flow
(clear cache, close the socket, go to `/login`); a `400` fell through as an
ordinary query failure, so a tab whose refresh cookie had gone rendered
"Something went wrong — Refresh token required" on a page it could no longer
load and retried the endpoint every few seconds (Nov 9 2026).
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession as SQLModelAsyncSession
from starlette.requests import Request
from starlette.responses import Response

from mirrorr.api.routers.auth import refresh


def _request(headers: dict[str, str] | None = None) -> Request:
    raw = [(key.lower().encode(), value.encode()) for key, value in (headers or {}).items()]
    return Request({"type": "http", "headers": raw, "client": ("127.0.0.1", 1234)})


def test_refresh_without_a_token_is_401():
    async def scenario() -> None:
        engine = create_async_engine("sqlite+aiosqlite://")
        async with engine.begin() as conn:
            await conn.run_sync(SQLModel.metadata.create_all)
        maker = async_sessionmaker(engine, class_=SQLModelAsyncSession, expire_on_commit=False)

        async with maker() as db:
            with pytest.raises(HTTPException) as caught:
                await refresh(_request(), Response(), None, db)

        assert caught.value.status_code == 401
        assert caught.value.detail == "Refresh token required"
        await engine.dispose()

    asyncio.run(scenario())
