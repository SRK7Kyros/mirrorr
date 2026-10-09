"""Tests for the bundled default-plugin sync and its opt-out flag."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from mirrorr.core import MirrorrCore
from mirrorr.startup.config import MirrorrSettings


def _core(settings: MirrorrSettings) -> SimpleNamespace:
    """A stand-in for MirrorrCore: ``_ensure_plugin_dirs`` only needs these two."""
    return SimpleNamespace(
        settings=settings,
        _copy_default_plugins=MirrorrCore._copy_default_plugins,
    )


def _run(settings: MirrorrSettings) -> None:
    asyncio.run(MirrorrCore._ensure_plugin_dirs(_core(settings)))


def test_sync_defaults_on():
    assert MirrorrSettings().sync_default_plugins is True


def test_sync_reads_env_false(tmp_path, monkeypatch):
    monkeypatch.setenv("SYNC_DEFAULT_PLUGINS", "false")
    settings = MirrorrSettings.create_from_env(tmp_path / "absent.env")
    assert settings.sync_default_plugins is False


def test_builtins_are_copied_when_enabled(tmp_path):
    settings = MirrorrSettings(base_dir=tmp_path)
    _run(settings)
    assert (settings.engines_dir / "yt_dlp_piped.py").is_file()
    assert (settings.resolvers_dir / "static.py").is_file()


def test_flag_disables_copying_builtins(tmp_path):
    settings = MirrorrSettings(base_dir=tmp_path, sync_default_plugins=False)
    _run(settings)
    # the dirs still exist (boot validation globs them), but stay empty
    assert settings.engines_dir.is_dir()
    assert settings.resolvers_dir.is_dir()
    assert list(settings.engines_dir.glob("*.py")) == []
    assert list(settings.resolvers_dir.glob("*.py")) == []


def test_builtin_is_restored_only_when_changed(tmp_path):
    settings = MirrorrSettings(base_dir=tmp_path)
    _run(settings)
    dest = settings.resolvers_dir / "static.py"
    original = dest.read_text()
    # a stale/edited built-in is overwritten from the package copy...
    dest.write_text("# stale\n")
    _run(settings)
    assert dest.read_text() == original
    # ...but an unchanged built-in is left alone (mtime preserved)
    mtime = dest.stat().st_mtime_ns
    _run(settings)
    assert dest.stat().st_mtime_ns == mtime
