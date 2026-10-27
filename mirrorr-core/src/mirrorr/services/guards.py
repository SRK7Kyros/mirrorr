"""Guards for a capture nobody is watching.

Two ways an unattended run fails quietly. The content disk fills and every
write after that fails — or the host itself goes down with it. A live source
dies while its engine keeps running, leaving the row ``recording`` for ever
and a frozen artifact that still looks like a capture in progress. Both are
answered from what the stream itself writes, so neither needs the network.
"""

from __future__ import annotations

import shutil
from pathlib import Path

_GB = 1024**3


def disk_refusal(path: Path, min_free_gb: float) -> str | None:
    """Answer why a capture may not start here, or ``None`` when there is room."""
    if min_free_gb <= 0:
        return None
    try:
        free = shutil.disk_usage(path).free
    except OSError:
        return None  # a folder that does not exist yet is not a disk problem
    if free >= min_free_gb * _GB:
        return None
    return f"only {free / _GB:.1f} GB free on the content disk (needs {min_free_gb:g} GB)"


def progress(folder: Path) -> tuple[float, int]:
    """The stream's own output as ``(newest write, total bytes)``.

    The playlist is rewritten per segment and the segment folder grows, so a
    live source moves one of the two and a dead one moves neither — while a
    sliding window that deletes as it writes still moves the newest write.
    """
    paths = [folder / "stream.m3u8"]
    segments = folder / "segments"
    if segments.is_dir():
        paths.extend(p for p in segments.iterdir() if p.is_file())

    newest, total = 0.0, 0
    for path in paths:
        try:
            info = path.stat()
        except OSError:
            continue
        newest = max(newest, info.st_mtime)
        total += info.st_size
    return newest, total
