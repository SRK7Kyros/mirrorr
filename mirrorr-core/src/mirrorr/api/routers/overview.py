"""The console's ops numbers, in one round trip.

The strip above the sessions list and the storage line above the recordings
list used to be assembled from list endpoints — counts guessed from a page
header, disk from nothing at all. Every number is scoped by the same predicate
the lists are paginated through (``access_predicate``), so a count can never
describe a row its reader may not open; an admin sees everything, exactly as
the lists answer them.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import true
from sqlmodel.ext.asyncio.session import AsyncSession

from mirrorr.api.dependencies import AuthState, _get_db, require_auth
from mirrorr.api.privileged import PrivilegedRoute
from mirrorr.api.schemas import OverviewResponse
from mirrorr.di import container
from mirrorr.services import overview
from mirrorr.services.permissions import access_predicate

overview_router = APIRouter(prefix="/overview", route_class=PrivilegedRoute)


@overview_router.get("", response_model=OverviewResponse)
async def get_overview(
    db: AsyncSession = Depends(_get_db), auth: AuthState = Depends(require_auth)
):
    """What is running, what failed recently, what the recordings cost, what is next."""
    if auth.is_admin:
        return await overview.summarise(
            db, lambda _model: true(), content_dir=container.settings.content_dir
        )
    token = auth.user.username if auth.user else ""
    return await overview.summarise(
        db,
        lambda model: access_predicate(model, token),
        content_dir=container.settings.content_dir,
    )
