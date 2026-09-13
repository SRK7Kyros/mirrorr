from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from mirrorr.api.routers.crud import _enforce_autorun_update_guard
from mirrorr.api.schemas import UpdateAutorunRequest
from mirrorr.storage.enums import AutorunStatus
from mirrorr.storage.models import Autorun


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _make(status: AutorunStatus, start: datetime, end: datetime) -> Autorun:
    return Autorun(
        user_friendly_name="News Hour",
        snake_case_name="news-hour",
        engine_id=1,
        resolver_id=1,
        status=status,
        start_time=start,
        end_time=end,
    )


def _rule_of(exc: HTTPException) -> str:
    assert isinstance(exc.detail, dict)
    return exc.detail["rule"]


def test_scheduled_future_move_passes():
    now = _now()
    existing = _make(AutorunStatus.SCHEDULED, now + timedelta(hours=1), now + timedelta(hours=2))
    _enforce_autorun_update_guard(
        existing,
        {"start_time": now + timedelta(hours=2), "end_time": now + timedelta(hours=3)},
    )


def test_scheduled_past_start_is_time_travel():
    now = _now()
    existing = _make(AutorunStatus.SCHEDULED, now + timedelta(hours=1), now + timedelta(hours=2))
    with pytest.raises(HTTPException) as ei:
        _enforce_autorun_update_guard(existing, {"start_time": now - timedelta(hours=1)})
    assert ei.value.status_code == 422
    assert _rule_of(ei.value) == "time-travel"


def test_end_before_start_rejected():
    now = _now()
    existing = _make(AutorunStatus.SCHEDULED, now + timedelta(hours=1), now + timedelta(hours=3))
    with pytest.raises(HTTPException) as ei:
        _enforce_autorun_update_guard(
            existing,
            {"start_time": now + timedelta(hours=2), "end_time": now + timedelta(hours=1)},
        )
    assert ei.value.status_code == 422
    assert _rule_of(ei.value) == "end-before-start"


def test_overdue_rearm_future_only():
    now = _now()
    existing = _make(AutorunStatus.SCHEDULED, now - timedelta(hours=1), now + timedelta(hours=1))
    with pytest.raises(HTTPException) as ei:
        _enforce_autorun_update_guard(existing, {"start_time": now - timedelta(minutes=30)})
    assert ei.value.status_code == 422
    assert _rule_of(ei.value) == "time-travel"
    _enforce_autorun_update_guard(
        existing,
        {"start_time": now + timedelta(minutes=30), "end_time": now + timedelta(hours=2)},
    )


def test_live_start_frozen():
    now = _now()
    for status in (AutorunStatus.ACTIVE, AutorunStatus.RECORDING):
        existing = _make(status, now - timedelta(hours=1), now + timedelta(hours=1))
        with pytest.raises(HTTPException) as ei:
            _enforce_autorun_update_guard(existing, {"start_time": now - timedelta(minutes=30)})
        assert ei.value.status_code == 409
        assert _rule_of(ei.value) == "live-start-frozen"


def test_live_config_frozen_rename_free():
    now = _now()
    existing = _make(AutorunStatus.ACTIVE, now - timedelta(hours=1), now + timedelta(hours=1))
    with pytest.raises(HTTPException) as ei:
        _enforce_autorun_update_guard(existing, {"engine_id": 2})
    assert ei.value.status_code == 409
    assert _rule_of(ei.value) == "live-config-frozen"
    _enforce_autorun_update_guard(existing, {"user_friendly_name": "Renamed"})


def test_live_end_edits_free_including_shorten_to_past():
    now = _now()
    existing = _make(AutorunStatus.ACTIVE, now - timedelta(hours=1), now + timedelta(hours=1))
    _enforce_autorun_update_guard(existing, {"end_time": now + timedelta(minutes=30)})
    _enforce_autorun_update_guard(existing, {"end_time": now - timedelta(minutes=1)})


def test_teardown_frozen():
    now = _now()
    for status in (AutorunStatus.TERMINATING, AutorunStatus.REMUXING, AutorunStatus.FINALIZING):
        existing = _make(status, now - timedelta(hours=2), now - timedelta(hours=1))
        with pytest.raises(HTTPException) as ei:
            _enforce_autorun_update_guard(existing, {"end_time": now + timedelta(hours=1)})
        assert ei.value.status_code == 409
        assert _rule_of(ei.value) == "teardown-race"


def test_spent_history_immutable_rename_free():
    now = _now()
    for status in (AutorunStatus.COMPLETED, AutorunStatus.FAILED):
        existing = _make(status, now - timedelta(hours=2), now - timedelta(hours=1))
        with pytest.raises(HTTPException) as ei:
            _enforce_autorun_update_guard(existing, {"end_time": now + timedelta(hours=1)})
        assert ei.value.status_code == 409
        assert _rule_of(ei.value) == "history-immutable"
        with pytest.raises(HTTPException) as ei2:
            _enforce_autorun_update_guard(existing, {"engine_id": 2})
        assert _rule_of(ei2.value) == "history-immutable"
        _enforce_autorun_update_guard(existing, {"user_friendly_name": "Renamed"})


def test_status_writes_never_reach_guard():
    req = UpdateAutorunRequest.model_validate(
        {"user_friendly_name": "x", "status": "active", "next_run_at": "2026-01-01T00:00:00"}
    )
    assert req.model_dump(exclude_unset=True) == {"user_friendly_name": "x"}
