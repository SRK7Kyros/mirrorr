from __future__ import annotations

import pytest
from fastapi import HTTPException

from mirrorr.api.routers.crud import _merge_profile_capture, _resolve_capture_target
from mirrorr.storage.models import Profile


def _profile(**overrides) -> Profile:
    base = dict(
        name="Evening News",
        default_engine_id=7,
        resolver_id=3,
        resolver_config={"channel": "44"},
        retry_mode="retry",
        retry_config={"attempts": 3},
    )
    base.update(overrides)
    return Profile(**base)


def test_profile_alone_supplies_engine_resolver_and_policy():
    profile = _profile()
    assert _resolve_capture_target(profile, None, None, None, None, None) == (
        7,
        3,
        {"channel": "44"},
        "retry",
        {"attempts": 3},
    )


def test_explicit_fields_override_the_profile():
    profile = _profile()
    assert _resolve_capture_target(profile, 9, 5, {"channel": "1"}, "none", {}) == (
        9,
        5,
        {"channel": "1"},
        "none",
        {},
    )


def test_bare_request_keeps_engine_resolver_and_fills_defaults():
    assert _resolve_capture_target(None, 7, 3, None, None, None) == (7, 3, {}, "none", {})


def test_bare_request_without_engine_or_resolver_is_rejected():
    with pytest.raises(HTTPException) as ei:
        _resolve_capture_target(None, None, 3, None, None, None)
    assert ei.value.status_code == 422
    with pytest.raises(HTTPException):
        _resolve_capture_target(None, 7, None, None, None, None)


def test_profile_change_rewrites_the_capture_config():
    merged = _merge_profile_capture(_profile(), {"profile_id": 9, "recording": True})
    assert merged == {
        "profile_id": 9,
        "recording": True,
        "engine_id": 7,
        "resolver_id": 3,
        "resolver_config": {"channel": "44"},
        "retry_mode": "retry",
        "retry_config": {"attempts": 3},
    }


def test_explicit_capture_fields_win_over_the_new_profile():
    merged = _merge_profile_capture(_profile(), {"profile_id": 9, "engine_id": 11, "retry_mode": "none"})
    assert (merged["engine_id"], merged["resolver_id"], merged["retry_mode"]) == (11, 3, "none")
    assert merged["resolver_config"] == {"channel": "44"}


def test_unlinking_the_profile_keeps_engine_and_resolver():
    merged = _merge_profile_capture(None, {"profile_id": None, "engine_id": 2, "resolver_id": 4})
    assert (merged["engine_id"], merged["resolver_id"], merged["resolver_config"]) == (2, 4, {})
