"""``GET /sessions/{id}/logs`` must never hand a client absolute server paths.

ffmpeg/yt-dlp write their diagnostics into ``<session_folder>/logs/``, and those
diagnostics contain absolute filesystem paths (the remux step demonstrably does).
The endpoint tails those files verbatim, so it redacts the content root on the
way out.
"""

from __future__ import annotations

from mirrorr.api.routers.logs import _redact_paths
from mirrorr.di import container
from mirrorr.startup.config import MirrorrSettings


def test_content_root_collapses_to_its_public_path(tmp_path):
    container.reset()
    try:
        container.configure(
            settings=MirrorrSettings(base_dir=tmp_path),
            db_factory=None,
            event_bus=None,
        )
        line = f"Output #0, hls, to '{tmp_path}/content/speedcubing/stream.m3u8':"
        assert _redact_paths([line]) == [
            "Output #0, hls, to '/content/speedcubing/stream.m3u8':"
        ]
    finally:
        container.reset()


def test_lines_are_untouched_when_the_container_is_not_booted(tmp_path):
    container.reset()
    line = f"to '{tmp_path}/content/speedcubing/stream.m3u8':"
    assert _redact_paths([line]) == [line]
