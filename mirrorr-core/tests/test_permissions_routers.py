"""W2-T1 — the frozen capability mapping on every ``crud`` router gate.

Every action is asserted against the frozen table: a caller holding the mapped
capability passes, and every other granted capability gets a real 403 (the
router's own refusal — not a log line). Owner and admin pass everything; a
legacy ``VIEW``-only grant reads but never controls, edits or deletes.

The ASGI harness (temp DB, per-request auth stub) is reused from
``test_resource_access``; the control path (``_send_control``) is stubbed so a
passing ``OPERATE`` gate is observable without a live supervisor/NATS.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

from mirrorr.storage.enums import Capability, ResourceType
from mirrorr.storage.models import Profile, ResolverSource, ResourceAccess

from test_resource_access import _harness, _seed

_CONTROL_STUB = "mirrorr.api.routers.crud._send_control"
_CAPS = (Capability.VIEW, Capability.OPERATE, Capability.EDIT, Capability.DELETE)


def _actions(ids: dict[str, int]) -> dict[str, list[tuple[str, str, str, dict | None, Capability]]]:
    """(label, method, path, body, capability) — one row per frozen-table entry."""
    return {
        "session": [
            ("read", "GET", f"/sessions/{ids['session']}", None, Capability.VIEW),
            ("stop", "POST", f"/sessions/{ids['session']}/stop", None, Capability.OPERATE),
            ("enable_recording", "POST", f"/sessions/{ids['session']}/recording/enable", None, Capability.OPERATE),
            ("disable_recording", "POST", f"/sessions/{ids['session']}/recording/disable", None, Capability.OPERATE),
            ("save_as_profile", "POST", f"/sessions/{ids['session']}/save-as-profile", {"name": "s-prof"}, Capability.VIEW),
            ("delete", "DELETE", f"/sessions/{ids['session']}", None, Capability.DELETE),
        ],
        "autorun": [
            ("read", "GET", f"/autoruns/{ids['autorun']}", None, Capability.VIEW),
            ("update", "PUT", f"/autoruns/{ids['autorun']}", {"user_friendly_name": "renamed"}, Capability.EDIT),
            ("save_as_profile", "POST", f"/autoruns/{ids['autorun']}/save-as-profile", {"name": "a-prof"}, Capability.VIEW),
            ("delete", "DELETE", f"/autoruns/{ids['autorun']}", None, Capability.DELETE),
        ],
        "profile": [
            ("read", "GET", f"/profiles/{ids['profile']}", None, Capability.VIEW),
            ("update", "PUT", f"/profiles/{ids['profile']}", {"name": "bob news"}, Capability.EDIT),
            ("delete", "DELETE", f"/profiles/{ids['profile']}", None, Capability.DELETE),
        ],
        "source": [
            ("read", "GET", f"/sources/{ids['source']}", None, Capability.VIEW),
            ("update", "PUT", f"/sources/{ids['source']}", {"name": "bob source"}, Capability.EDIT),
            ("delete", "DELETE", f"/sources/{ids['source']}", None, Capability.DELETE),
        ],
        "recording": [
            ("read", "GET", f"/recordings/{ids['recording']}", None, Capability.VIEW),
            ("delete", "DELETE", f"/recordings/{ids['recording']}", None, Capability.DELETE),
        ],
    }


async def _request(client, method: str, url: str, body: dict | None):
    if method == "GET":
        return await client.get(url)
    if method == "POST":
        return await client.post(url, json=body)
    if method == "PUT":
        return await client.put(url, json=body)
    if method == "DELETE":
        return await client.delete(url)
    raise AssertionError(f"unhandled method {method}")


async def _grant(maker, resource_type: ResourceType, resource_id: int, username: str, *capabilities) -> None:
    async with maker() as db:
        for capability in capabilities:
            db.add(ResourceAccess(
                resource_type=resource_type,
                resource_id=resource_id,
                username=username,
                capability=capability,
            ))
        await db.commit()


async def _owner_token(maker, model, resource_id: int) -> str:
    async with maker() as db:
        return (await db.get(model, resource_id)).requester_user_token


def test_every_action_requires_exactly_its_capability(tmp_path):
    """Granting capability C: its mapped action passes, and so does any action
    gated on VIEW (C implies VIEW). Every other mapping is a real 403, and any
    grant admits the row to the list."""
    async def scenario():
        for tag in _actions({"session": 0, "autorun": 0, "profile": 0, "source": 0, "recording": 0}):
            for capability in _CAPS:
                sub = tmp_path / f"{tag}-{capability.name}"
                sub.mkdir(parents=True, exist_ok=True)
                async with _harness(sub) as h:
                    ids = await _seed(h.maker)
                    await _grant(h.maker, ResourceType(tag), ids[tag], "bob", capability)
                    h.as_user("bob")
                    # Evaluated before the actions: a DELETE grant removes the row,
                    # which would empty the list it is meant to appear in.
                    listing = (await h.client.get(f"/{tag}s/")).json()["items"]
                    assert ids[tag] in [row["id"] for row in listing], (
                        f"{tag}/{capability.name}: any grant implies VIEW, so the row must list"
                    )
                    with patch(_CONTROL_STUB, AsyncMock(return_value={"status": "stopping"})):
                        for label, method, url, body, required in _actions(ids)[tag]:
                            resp = await _request(h.client, method, url, body)
                            allowed = capability == required or required == Capability.VIEW
                            if allowed:
                                assert resp.status_code == 200, (
                                    f"{tag}/{capability.name}/{label}: {resp.status_code} {resp.text}"
                                )
                            else:
                                assert resp.status_code == 403, (
                                    f"{tag}/{capability.name}/{label}: {resp.status_code} {resp.text}"
                                )
                                assert resp.json().get("detail"), f"{tag}/{capability.name}/{label}: empty 403 body"

    asyncio.run(scenario())


def test_owner_and_admin_pass_every_action(tmp_path):
    async def scenario():
        for principal, is_admin in (("alice", False), ("root", True)):
            for tag in ("session", "autorun", "profile", "source", "recording"):
                sub = tmp_path / f"{principal}-{tag}"
                sub.mkdir(parents=True, exist_ok=True)
                async with _harness(sub) as h:
                    ids = await _seed(h.maker)
                    h.as_user(principal, admin=is_admin)
                    with patch(_CONTROL_STUB, AsyncMock(return_value={"status": "stopping"})):
                        for label, method, url, body, _required in _actions(ids)[tag]:
                            resp = await _request(h.client, method, url, body)
                            assert resp.status_code == 200, (
                                f"{principal}/{tag}/{label}: {resp.status_code} {resp.text}"
                            )

    asyncio.run(scenario())


def test_view_only_grant_reads_but_never_controls_edits_or_deletes(tmp_path):
    """stale_state + privilege escalation: a legacy VIEW-only grant must not open
    stop/update/delete — and adding exactly the matching capability flips the gate,
    proving the gate (not a stray allow) is what decides."""
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            sid, aid = ids["session"], ids["autorun"]
            await _grant(h.maker, ResourceType.SESSION, sid, "bob", Capability.VIEW)
            await _grant(h.maker, ResourceType.AUTORUN, aid, "bob", Capability.VIEW)
            h.as_user("bob")

            assert (await h.client.get(f"/sessions/{sid}")).status_code == 200
            assert sid in [s["id"] for s in (await h.client.get("/sessions/")).json()["items"]]
            assert (await h.client.get(f"/autoruns/{aid}")).status_code == 200
            cloned = await h.client.post(f"/sessions/{sid}/save-as-profile", json={"name": "mine"})
            assert cloned.status_code == 200, cloned.text

            with patch(_CONTROL_STUB, AsyncMock(return_value={"status": "stopping"})):
                denied = {
                    "stop": await h.client.post(f"/sessions/{sid}/stop"),
                    "enable_recording": await h.client.post(f"/sessions/{sid}/recording/enable"),
                    "update_autorun": await h.client.put(f"/autoruns/{aid}", json={"user_friendly_name": "x"}),
                    "delete_session": await h.client.delete(f"/sessions/{sid}"),
                    "delete_autorun": await h.client.delete(f"/autoruns/{aid}"),
                }
            for label, resp in denied.items():
                assert resp.status_code == 403, f"{label}: {resp.status_code} {resp.text}"
                assert resp.json().get("detail"), f"{label}: empty 403 body"

            await _grant(h.maker, ResourceType.SESSION, sid, "bob", Capability.OPERATE)
            with patch(_CONTROL_STUB, AsyncMock(return_value={"status": "stopping"})):
                assert (await h.client.post(f"/sessions/{sid}/stop")).status_code == 200

            await _grant(h.maker, ResourceType.AUTORUN, aid, "bob", Capability.EDIT)
            assert (await h.client.put(f"/autoruns/{aid}", json={"user_friendly_name": "x"})).status_code == 200

            await _grant(h.maker, ResourceType.SESSION, sid, "bob", Capability.DELETE)
            assert (await h.client.delete(f"/sessions/{sid}")).status_code == 200

    asyncio.run(scenario())


def test_no_grant_denies_every_gated_action(tmp_path):
    """misleading_success_output: with no grant every gated call is the router's
    403. Were any gate a no-op these would be 200 — the status and body are the
    assertion, never a log line."""
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            h.as_user("bob")
            with patch(_CONTROL_STUB, AsyncMock(return_value={"status": "stopping"})):
                for tag in ("session", "autorun", "profile", "source", "recording"):
                    for label, method, url, body, _required in _actions(ids)[tag]:
                        resp = await _request(h.client, method, url, body)
                        assert resp.status_code == 403, f"{tag}/{label}: {resp.status_code} {resp.text}"
                        assert resp.json().get("detail"), f"{tag}/{label}: empty 403 body"
                    listing = (await h.client.get(f"/{tag}s/")).json()["items"]
                    assert ids[tag] not in [row["id"] for row in listing], tag

    asyncio.run(scenario())


def test_edit_grantee_update_does_not_take_ownership(tmp_path):
    """EDIT is update, never ownership: a grantee's PUT must leave the owner of
    record (equivalently — never silently gain all six capabilities)."""
    async def scenario():
        async with _harness(tmp_path) as h:
            ids = await _seed(h.maker)
            await _grant(h.maker, ResourceType.PROFILE, ids["profile"], "bob", Capability.EDIT)
            await _grant(h.maker, ResourceType.SOURCE, ids["source"], "bob", Capability.EDIT)
            h.as_user("bob")

            assert (await h.client.put(f"/profiles/{ids['profile']}", json={"name": "bob news"})).status_code == 200
            assert (await h.client.put(f"/sources/{ids['source']}", json={"name": "bob source"})).status_code == 200

            assert await _owner_token(h.maker, Profile, ids["profile"]) == "alice"
            assert await _owner_token(h.maker, ResolverSource, ids["source"]) == "alice"

    asyncio.run(scenario())
