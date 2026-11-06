"""``POST /sessions/`` with ``autorun_id`` — the console's "Run now".

The client used to fire a plain session create and drop the link, so the run
existed but the schedule it came from never saw it: the autorun detail page's
"linked run" panel stayed empty and the run's history was wrong. The link has
to be accepted, persisted, and guarded: a caller may only attach a run to a
schedule they can see.
"""

from __future__ import annotations

import asyncio

from mirrorr.storage.models import Autorun, Session

from test_resource_access import NOW, _harness, _seed


async def _bobs_autorun(maker, ids: dict[str, int]) -> int:
    async with maker() as db:
        autorun = Autorun(
            user_friendly_name="Bob Nightly",
            snake_case_name="bob_nightly",
            engine_id=ids["engine"],
            resolver_id=ids["resolver"],
            start_time=NOW,
            end_time=NOW,
            requester_user_token="bob",
        )
        db.add(autorun)
        await db.commit()
        return autorun.id


def test_run_now_persists_the_autorun_link(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            h.as_user("alice")

            created = await h.client.post(
                "/sessions/",
                json={
                    "engine_id": ids["engine"],
                    "resolver_id": ids["resolver"],
                    "autorun_id": ids["autorun"],
                    "recording": True,
                },
            )
            assert created.status_code == 200, created.text
            body = created.json()
            assert body["autorun_id"] == ids["autorun"]

            async with h.maker() as db:
                row = await db.get(Session, body["id"])
                assert row is not None
                assert row.autorun_id == ids["autorun"]

    asyncio.run(scenario())


def test_run_now_refuses_someone_elses_schedule(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            bobs = await _bobs_autorun(h.maker, ids)
            h.as_user("alice")

            resp = await h.client.post(
                "/sessions/",
                json={
                    "engine_id": ids["engine"],
                    "resolver_id": ids["resolver"],
                    "autorun_id": bobs,
                },
            )
            assert resp.status_code == 403, resp.text
            async with h.maker() as db:
                assert (await db.get(Autorun, bobs)).requester_user_token == "bob"

    asyncio.run(scenario())


def test_run_now_rejects_an_unknown_schedule(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            h.as_user("alice")

            resp = await h.client.post(
                "/sessions/",
                json={
                    "engine_id": ids["engine"],
                    "resolver_id": ids["resolver"],
                    "autorun_id": 999_999,
                },
            )
            assert resp.status_code == 400, resp.text

    asyncio.run(scenario())
