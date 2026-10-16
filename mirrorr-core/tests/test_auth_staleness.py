from __future__ import annotations

import asyncio
from unittest.mock import patch

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession as SQLModelAsyncSession

from mirrorr.api.dependencies import _resolve_auth
from mirrorr.storage.enums import UserRole
from mirrorr.storage.models import User


def test_stale_token_does_not_keep_admin_privileges():
    """A token issued before the password change must not carry ``is_admin``.

    ``change_password`` bumps ``credentials_version`` and ``_resolve_auth``
    nulls the user on a ``cv`` mismatch. The admin flag has to fall with the
    user, otherwise a revoked admin token still passes
    ``has_capability`` (which checks ``is_admin`` before ``user``).
    """

    async def scenario() -> None:
        engine = create_async_engine("sqlite+aiosqlite://")
        async with engine.begin() as conn:
            await conn.run_sync(SQLModel.metadata.create_all)
        maker = async_sessionmaker(engine, class_=SQLModelAsyncSession, expire_on_commit=False)

        async with maker() as db:
            db.add(
                User(
                    username="admin",
                    password_hash="x",
                    role=UserRole.ADMIN,
                    credentials_version=2,
                )
            )
            await db.commit()

        # Minted at cv=1, i.e. before the password change bumped it to 2.
        stale = {"username": "admin", "role": "admin", "cv": 1}
        with patch("mirrorr.api.jwt.decode_access_token", return_value=stale):
            async with maker() as db:
                auth = await _resolve_auth(db, "", "stale-token")

        assert auth.user is None
        assert auth.is_admin is False

        # A current token still resolves to an admin.
        current = {"username": "admin", "role": "admin", "cv": 2}
        with patch("mirrorr.api.jwt.decode_access_token", return_value=current):
            async with maker() as db:
                auth = await _resolve_auth(db, "", "current-token")

        assert auth.user is not None
        assert auth.is_admin is True

        await engine.dispose()

    asyncio.run(scenario())