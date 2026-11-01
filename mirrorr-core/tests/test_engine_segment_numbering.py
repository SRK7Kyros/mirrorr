"""A retry must not overwrite the segments the previous attempt captured."""

from __future__ import annotations

from mirrorr.default_plugins.engines.yt_dlp_piped import _next_segment_number


def test_absent_folder_starts_at_zero(tmp_path):
    assert _next_segment_number(tmp_path / "absent") == 0


def test_empty_folder_starts_at_zero(tmp_path):
    assert _next_segment_number(tmp_path) == 0


def test_continues_past_the_live_window(tmp_path):
    for i in (0, 1, 2):
        (tmp_path / f"stream-{i:012d}.ts").write_bytes(b"\x47")
    assert _next_segment_number(tmp_path) == 3


def test_ignores_a_gap_the_window_deleted(tmp_path):
    (tmp_path / "stream-000000000000.ts").write_bytes(b"\x47")
    (tmp_path / "stream-000000000007.ts").write_bytes(b"\x47")
    assert _next_segment_number(tmp_path) == 8


def test_ignores_files_that_are_not_segments(tmp_path):
    (tmp_path / "stream-000000000004.ts").write_bytes(b"\x47")
    (tmp_path / "notes.txt").write_text("x")
    assert _next_segment_number(tmp_path) == 5
