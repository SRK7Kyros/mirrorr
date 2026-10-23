"""An autorun reports its newest session's state, not the last write to land.

A fallback rung starts a fresh session while the previous one is failing, so the
failed rung's status update can arrive after the fallback is already live. Before
the guard the autorun then read FAILED while its fallback was recording (seen
live on Oct 23 2026, session 2's failure landing on top of session 3).
"""

from __future__ import annotations

import asyncio

from mirrorr.services.session_lifecycle import update_session
from mirrorr.startup.config import MirrorrSettings
from mirrorr.storage.enums import AutorunStatus, SessionStatus
from mirrorr.storage.models import Autorun, Session

from test_resource_access import _harness, _seed


async def _two_rungs(maker, ids: dict[str, int]) -> dict[str, int]:
    async with maker() as db:
        rungs = [
            Session(
                autorun_id=ids["autorun"],
                engine_id=ids["engine"],
                resolver_id=ids["resolver"],
                status=SessionStatus.INITIALIZING,
                requester_user_token="alice",
            )
            for _ in range(2)
        ]
        db.add_all(rungs)
        await db.commit()
        return {"primary": rungs[0].id, "fallback": rungs[1].id}


async def _autorun_status(maker, autorun_id: int) -> AutorunStatus:
    async with maker() as db:
        return (await db.get(Autorun, autorun_id)).status


def test_a_failed_rung_cannot_overwrite_the_fallbacks_live_status(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            rungs = await _two_rungs(h.maker, ids)
            settings = MirrorrSettings(base_dir=tmp_path)

            await update_session(settings, rungs["fallback"], status=SessionStatus.RECORDING)
            assert await _autorun_status(h.maker, ids["autorun"]) == AutorunStatus.RECORDING

            await update_session(settings, rungs["primary"], status=SessionStatus.FAILED)
            assert await _autorun_status(h.maker, ids["autorun"]) == AutorunStatus.RECORDING

    asyncio.run(scenario())


def test_the_newest_session_still_speaks_for_the_autorun(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            rungs = await _two_rungs(h.maker, ids)
            settings = MirrorrSettings(base_dir=tmp_path)

            await update_session(settings, rungs["fallback"], status=SessionStatus.FAILED)

            assert await _autorun_status(h.maker, ids["autorun"]) == AutorunStatus.FAILED

    asyncio.run(scenario())
