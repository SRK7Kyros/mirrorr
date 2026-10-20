"""``GET /sessions/?autorun=`` — the server-side filter that replaced the
client's history scan.

An autorun detail page used to page through every session to find the run its
schedule spawned. The filter must return exactly that autorun's sessions, keep
the access predicate intact (a filter narrows what a caller may see, it never
widens it), and report a filtered total.
"""

from __future__ import annotations

import asyncio

from mirrorr.storage.enums import SessionStatus
from mirrorr.storage.models import Autorun, Session

from test_resource_access import NOW, _harness, _seed


async def _add_second_run(maker, ids: dict[str, int], owner: str) -> dict[str, int]:
    async with maker() as db:
        autorun = Autorun(
            user_friendly_name="Other Window",
            snake_case_name="other_window",
            engine_id=ids["engine"],
            resolver_id=ids["resolver"],
            start_time=NOW,
            end_time=NOW,
            requester_user_token=owner,
        )
        db.add(autorun)
        await db.commit()
        own = Session(
            autorun_id=ids["autorun"],
            engine_id=ids["engine"],
            resolver_id=ids["resolver"],
            status=SessionStatus.COMPLETED,
            requester_user_token="alice",
        )
        other = Session(
            autorun_id=autorun.id,
            engine_id=ids["engine"],
            resolver_id=ids["resolver"],
            status=SessionStatus.COMPLETED,
            requester_user_token=owner,
        )
        loose = Session(
            engine_id=ids["engine"],
            resolver_id=ids["resolver"],
            status=SessionStatus.COMPLETED,
            requester_user_token="alice",
        )
        db.add_all([own, other, loose])
        await db.commit()
        return {"other_autorun": autorun.id, "own": own.id, "other": other.id, "loose": loose.id}


def test_autorun_filter_returns_only_that_schedules_runs(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            extra = await _add_second_run(h.maker, ids, "bob")
            h.as_user("alice", admin=True)

            resp = await h.client.get(f"/sessions/?autorun={ids['autorun']}&include_total=1")
            assert resp.status_code == 200, resp.text
            body = resp.json()
            returned = {row["id"] for row in body["items"]}
            assert returned == {ids["session"], extra["own"]}
            assert body["total"] == 2

            other = await h.client.get(f"/sessions/?autorun={extra['other_autorun']}")
            assert {row["id"] for row in other.json()["items"]} == {extra["other"]}

    asyncio.run(scenario())


def test_autorun_filter_keeps_the_access_predicate(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            h.as_user("carol")

            # carol owns none of alice's runs, so the filtered list is empty
            # even though the rows exist.
            resp = await h.client.get(f"/sessions/?autorun={ids['autorun']}")
            assert resp.status_code == 200, resp.text
            assert resp.json()["items"] == []

            h.as_user("alice")
            own = await h.client.get(f"/sessions/?autorun={ids['autorun']}")
            assert {row["id"] for row in own.json()["items"]} == {ids["session"]}

    asyncio.run(scenario())


def test_unknown_autorun_filter_is_an_empty_list_not_an_error(tmp_path):
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            h.as_user("alice", admin=True)

            resp = await h.client.get("/sessions/?autorun=999999")
            assert resp.status_code == 200, resp.text
            assert resp.json()["items"] == []
            assert (await h.client.get("/sessions/")).json()["items"]

    asyncio.run(scenario())
