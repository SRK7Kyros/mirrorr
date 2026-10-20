"""Parsing and scoping hardened after the Oct 2026 audit.

Three separate boundaries: the rate-limit key must not be spoofable, a bcrypt
password must never silently truncate, and an import must never link to another
user's profile by name.
"""

from __future__ import annotations

import asyncio

import pytest
from pydantic import ValidationError
from starlette.requests import Request

from mirrorr.api import auth as auth_module
from mirrorr.api.routers.auth import _client_ip
from mirrorr.api.routers.import_export import _profiles_owned_by
from mirrorr.api.schemas import ChangePasswordRequest, RegisterRequest


def _request(headers: dict[str, str], peer: str = "127.0.0.1") -> Request:
    raw = [(key.lower().encode(), value.encode()) for key, value in headers.items()]
    return Request({"type": "http", "headers": raw, "client": (peer, 1234)})


def test_rate_limit_key_takes_the_last_forwarded_hop():
    request = _request({"x-forwarded-for": "6.6.6.6, 203.0.113.9"})
    assert _client_ip(request) == "203.0.113.9"


def test_rate_limit_key_falls_back_to_the_peer():
    assert _client_ip(_request({})) == "127.0.0.1"


def test_a_password_over_the_bcrypt_limit_is_rejected_at_the_schema():
    with pytest.raises(ValidationError):
        RegisterRequest(username="alice", password="a" * 73)
    with pytest.raises(ValidationError):
        ChangePasswordRequest(old_password="x", new_password="é" * 37)


def test_a_password_at_the_bcrypt_limit_is_accepted():
    assert RegisterRequest(username="alice", password="a" * 72).password == "a" * 72


def test_hashing_a_password_over_the_limit_raises_rather_than_truncating():
    with pytest.raises(ValueError):
        auth_module.hash_password("a" * 73)
    assert auth_module.verify_password("a" * 73, "$2b$12$" + "x" * 53) is False


class _Profile:
    def __init__(self, name: str, owner: str | None) -> None:
        self.name = name
        self.requester_user_token = owner


def test_an_import_only_sees_the_requesters_own_profiles(monkeypatch):
    profiles = [_Profile("mine", "alice"), _Profile("theirs", "bob"), _Profile("orphan", None)]

    async def fake_get_all(db, model):
        return profiles

    monkeypatch.setattr("mirrorr.api.routers.import_export.crud.get_all", fake_get_all)

    mine = asyncio.run(_profiles_owned_by(object(), "alice"))
    assert [profile.name for profile in mine] == ["mine"]

    orphans = asyncio.run(_profiles_owned_by(object(), None))
    assert [profile.name for profile in orphans] == ["orphan"]
