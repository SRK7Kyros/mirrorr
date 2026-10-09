"""Regression guard for ``media_served`` on recordings.

``dev_serve_files`` only says "uvicorn mounts the content dir" (dev mode). In
production nginx serves ``/content/`` from the same root, so a file that is
present on disk has a working ``content_url`` even though the flag is off. The
old implementation returned ``dev_serve_files`` verbatim, which made every
recording look unserved in production and silently disabled the card preview.
"""

from __future__ import annotations

from types import SimpleNamespace

from mirrorr.api.routers.crud import _media_served
from mirrorr.di import container
from mirrorr.startup.config import MirrorrSettings


def _recording(folder, name: str = "speedcubing_10.mp4") -> SimpleNamespace:
    return SimpleNamespace(
        disk_path=str(folder),
        content_url=f"https://example.test/content/recordings/{folder.name}/{name}",
    )


def _with_container(tmp_path, *, dev_serve_files: bool):
    settings = MirrorrSettings(base_dir=tmp_path, dev_serve_files=dev_serve_files)
    container.configure(settings=settings, session_factory=None, event_bus=None)


def test_present_file_is_reported_as_served(tmp_path):
    folder = tmp_path / "recordings" / "speedcubing_10"
    folder.mkdir(parents=True)
    (folder / "speedcubing_10.mp4").write_bytes(b"media")

    container.reset()
    _with_container(tmp_path, dev_serve_files=False)
    try:
        assert _media_served(_recording(folder)) is True
    finally:
        container.reset()


def test_missing_file_is_not_reported_as_served(tmp_path):
    """The reaper frees a job's files but keeps its row — the URL is dead then."""
    folder = tmp_path / "recordings" / "speedcubing_10"
    folder.mkdir(parents=True)
    (folder / "player.html").write_text("<html></html>")

    container.reset()
    _with_container(tmp_path, dev_serve_files=False)
    try:
        assert _media_served(_recording(folder)) is False
    finally:
        container.reset()


def test_dev_serve_files_short_circuits(tmp_path):
    folder = tmp_path / "recordings" / "speedcubing_10"  # not even created

    container.reset()
    _with_container(tmp_path, dev_serve_files=True)
    try:
        assert _media_served(_recording(folder)) is True
    finally:
        container.reset()


def test_unbooted_container_is_not_served(tmp_path):
    folder = tmp_path / "recordings" / "speedcubing_10"
    folder.mkdir(parents=True)
    (folder / "speedcubing_10.mp4").write_bytes(b"media")

    container.reset()
    assert _media_served(_recording(folder)) is False
