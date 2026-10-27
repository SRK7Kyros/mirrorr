"""Track C — the console's ops numbers and its server-side search.

Two things the console could not answer before: *how much is here and what is
running* (it guessed a count from a page header and had no disk figure at all)
and *find a row that was never paged in* (ranking only ever saw the loaded
page). ``GET /overview`` answers the first in one round trip; ``?q=`` on the
sessions and recordings lists answers the second.

Both are scoped by the same access predicate the lists are paginated through,
which is the property asserted hardest here: a number must never describe a row
its reader may not open.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from mirrorr.services.search import like_pattern
from mirrorr.storage.enums import AutorunStatus, SessionStatus
from mirrorr.storage.models import Autorun, Recording, Session

from test_resource_access import _harness, _seed

NOW = datetime.now(timezone.utc).replace(tzinfo=None)


async def _add(maker, **kwargs) -> None:
    async with maker() as db:
        db.add_all(kwargs.get("rows") or [])
        await db.commit()


def _session(ids: dict[str, int], **kwargs) -> Session:
    return Session(
        profile_id=ids["profile"],
        engine_id=ids["engine"],
        resolver_id=ids["resolver"],
        requester_user_token="alice",
        **kwargs,
    )


def _recording(name: str, size: int, owner: str = "alice", **kwargs) -> Recording:
    return Recording(
        user_friendly_name=name,
        snake_case_name=name.lower().replace(" ", "_"),
        disk_path=f"/tmp/{name}.ts",
        content_url=f"http://h/content/{name}.ts",
        profile_name=kwargs.pop("profile_name", "Alice News"),
        engine_name="yt_dlp_piped",
        resolver_name="static",
        started_at=NOW,
        ended_at=NOW,
        duration_seconds=60.0,
        size_bytes=size,
        requester_user_token=owner,
        **kwargs,
    )


@pytest.mark.anyio
async def test_a_reader_sees_only_their_own_numbers(tmp_path):
    async with _harness(tmp_path) as h:
        idx = tmp_path / "content"
        idx.mkdir(exist_ok=True)
        ids = await _seed(h.maker)
        await _add(
            h.maker,
            rows=[
                _session(ids, status=SessionStatus.RECORDING, started_at=NOW),
                _session(ids, status=SessionStatus.FAILED, started_at=NOW - timedelta(hours=2)),
                _recording("Bob Tape", 500, owner="bob"),
            ],
        )

        h.as_user("alice")
        answer = await h.client.get("/overview")
        assert answer.status_code == 200
        body = answer.json()

        # Alice's seed holds one completed session, one 10-byte recording and
        # one scheduled autorun; nothing of Bob's leaks into any count.
        assert body["sessions"]["total"] == 3
        assert body["sessions"]["live"] == 1
        assert body["sessions"]["failed_24h"] == 1
        assert body["recordings"] == {"count": 1, "size_bytes": 10, "seconds": 1}
        assert body["disk"]["free_bytes"] > 0
        assert body["next_autorun"] is None  # the seed's autorun starts now, not ahead

        h.as_user("bob")
        mine = (await h.client.get("/overview")).json()
        assert mine["sessions"]["total"] == 0
        assert mine["recordings"] == {"count": 1, "size_bytes": 500, "seconds": 60}

        h.as_user("carol")
        empty = (await h.client.get("/overview")).json()
        assert empty["sessions"]["total"] == 0
        assert empty["recordings"]["count"] == 0


@pytest.mark.anyio
async def test_an_admin_counts_everything(tmp_path):
    async with _harness(tmp_path) as h:
        ids = await _seed(h.maker)
        await _add(h.maker, rows=[_recording("Bob Tape", 500, owner="bob")])
        h.as_user("alice", admin=True)

        body = (await h.client.get("/overview")).json()
        assert body["sessions"]["total"] == 1
        assert body["recordings"]["count"] == 2
        assert body["recordings"]["size_bytes"] == 510


@pytest.mark.anyio
async def test_a_failure_older_than_a_day_is_not_a_recent_failure(tmp_path):
    async with _harness(tmp_path) as h:
        ids = await _seed(h.maker)
        await _add(
            h.maker,
            rows=[
                _session(ids, status=SessionStatus.FAILED, started_at=NOW - timedelta(hours=30)),
                _session(ids, status=SessionStatus.FAILED),
            ],
        )
        h.as_user("alice")
        body = (await h.client.get("/overview")).json()
        # The second row never started, so its start is missing; it is still
        # counted, because a row that died before stamping a clock is the case
        # the strip most needs to show.
        assert body["sessions"]["failed_24h"] == 1


@pytest.mark.anyio
async def test_the_next_autorun_is_the_soonest_one_still_scheduled(tmp_path):
    async with _harness(tmp_path) as h:
        ids = await _seed(h.maker)
        await _add(
            h.maker,
            rows=[
                Autorun(
                    user_friendly_name="Later Race",
                    snake_case_name="later_race",
                    profile_id=ids["profile"],
                    engine_id=ids["engine"],
                    resolver_id=ids["resolver"],
                    start_time=NOW + timedelta(hours=5),
                    end_time=NOW + timedelta(hours=7),
                    status=AutorunStatus.SCHEDULED,
                    requester_user_token="alice",
                ),
                Autorun(
                    user_friendly_name="Sooner Race",
                    snake_case_name="sooner_race",
                    profile_id=ids["profile"],
                    engine_id=ids["engine"],
                    resolver_id=ids["resolver"],
                    start_time=NOW + timedelta(hours=1),
                    end_time=NOW + timedelta(hours=3),
                    status=AutorunStatus.SCHEDULED,
                    requester_user_token="alice",
                ),
                Autorun(
                    user_friendly_name="Finished Race",
                    snake_case_name="finished_race",
                    profile_id=ids["profile"],
                    engine_id=ids["engine"],
                    resolver_id=ids["resolver"],
                    start_time=NOW + timedelta(minutes=5),
                    end_time=NOW + timedelta(hours=1),
                    status=AutorunStatus.COMPLETED,
                    requester_user_token="alice",
                ),
                Autorun(
                    user_friendly_name="Bob Race",
                    snake_case_name="bob_race",
                    profile_id=ids["profile"],
                    engine_id=ids["engine"],
                    resolver_id=ids["resolver"],
                    start_time=NOW + timedelta(minutes=1),
                    end_time=NOW + timedelta(hours=1),
                    status=AutorunStatus.SCHEDULED,
                    requester_user_token="bob",
                ),
            ],
        )
        h.as_user("alice")
        body = (await h.client.get("/overview")).json()
        # Sooner than "Later", later than Bob's (which is not Alice's to see) and
        # only if it is still scheduled — a spent row is not "next".
        assert body["next_autorun"]["name"] == "Sooner Race"
        assert body["next_autorun"]["status"] == "scheduled"


@pytest.mark.anyio
async def test_a_recording_is_found_by_its_name_or_by_the_source_it_ran(tmp_path):
    async with _harness(tmp_path) as h:
        await _seed(h.maker)
        await _add(
            h.maker,
            rows=[
                _recording("Practice Two", 100, profile_name="F1 Weekend"),
                _recording("Qualifying", 200, profile_name="News Hour"),
                _recording("Bob Tape", 300, owner="bob"),
            ],
        )
        h.as_user("alice")

        names = [row["user_friendly_name"] for row in (await h.client.get("/recordings/?q=qual")).json()["items"]]
        assert names == ["Qualifying"]

        by_source = (await h.client.get("/recordings/?q=f1+weekend")).json()["items"]
        assert [row["user_friendly_name"] for row in by_source] == ["Practice Two"]

        # A term matching nothing of Bob's still finds nothing of Bob's.
        assert (await h.client.get("/recordings/?q=bob")).json()["items"] == []

        # An empty term is not a filter at all.
        assert len((await h.client.get("/recordings/?q=+ ")).json()["items"]) == 3


@pytest.mark.anyio
async def test_a_search_narrows_what_the_reader_already_may_see(tmp_path):
    async with _harness(tmp_path) as h:
        await _seed(h.maker)
        await _add(h.maker, rows=[_recording("Shared Tape", 100, owner="bob")])
        h.as_user("alice")
        # Even the owner's name is not an escape hatch: the row is not Alice's.
        assert (await h.client.get("/recordings/?q=Shared")).json()["items"] == []


@pytest.mark.anyio
async def test_a_session_is_found_by_the_names_its_card_shows(tmp_path):
    async with _harness(tmp_path) as h:
        ids = await _seed(h.maker)
        await _add(
            h.maker,
            rows=[
                _session(ids, status=SessionStatus.FAILED, started_at=NOW),
                _session(ids, status=SessionStatus.RECORDING, started_at=NOW),
            ],
        )
        h.as_user("alice")

        failed = (await h.client.get("/sessions/?q=failed")).json()["items"]
        assert [row["status"] for row in failed] == ["failed"]

        # The seed's profile is "Alice News"; both of the rows above plus the
        # seeded one ran it.
        assert len((await h.client.get("/sessions/?q=alice+news")).json()["items"]) == 3

        # The autorun filter and the term are combined, not either/or.
        narrowed = (
            await h.client.get(f"/sessions/?autorun={ids['autorun']}&q=failed")
        ).json()["items"]
        assert narrowed == []


def test_a_like_term_is_escaped_rather_than_widened():
    assert like_pattern(None) is None
    assert like_pattern("   ") is None
    assert like_pattern(" 100% ") == "%100\\%%"
    assert like_pattern("a_b") == "%a\\_b%"
    assert like_pattern("back\\slash") == "%back\\\\slash%"
