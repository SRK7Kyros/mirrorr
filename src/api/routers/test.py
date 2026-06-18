from sqlmodel.ext.asyncio.session import AsyncSession
from fastapi import APIRouter, Depends
from sqlmodel import select

from src.storage.models import Profile
from src.api.dependencies import _get_db_session
from src.storage.database import get_session

test_router = APIRouter()


@test_router.get("/test")
async def test(session: AsyncSession = Depends(_get_db_session)):
    profile = await session.get(Profile, 1)

    if profile is None:
        profile = Profile(name="test_profile", resolver_id=1, default_engine_id=1)
        session.add(profile)
        await session.commit()
        return {"message": "profile created"}
    else:
        await session.delete(profile)
        await session.commit()
        return {"message": "profile already existed, now deleted"}


@test_router.get("/test-query")
async def test_query():
    async with get_session() as session:
        result = await session.exec(select(Profile))
        output = result.all()
        return output