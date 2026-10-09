from __future__ import annotations

import os
import time
from pathlib import Path

from mirrorr.services.housekeeping import sweep_orphans


def test_sweep_reaps_only_old_unclaimed_directories(tmp_path):
    content = (tmp_path / "content").resolve()
    for name in ("speedcubing_2", "session-3_10/logs", "fresh", "recordings/rec1"):
        (content / name).mkdir(parents=True)
    (content / "autoruns").mkdir()

    stale = time.time() - 7200
    for target in (content / "session-3_10" / "logs", content / "session-3_10"):
        os.utime(target, (stale, stale))

    claimed = {Path("speedcubing_2"), Path("recordings/rec1")}
    reserved = {(content / "autoruns"), (content / "recordings")}

    reaped = sweep_orphans(content, claimed, reserved)

    assert reaped == ["session-3_10"]
    assert not (content / "session-3_10").exists()
    assert (content / "speedcubing_2").is_dir()
    assert (content / "recordings" / "rec1").is_dir()
    assert (content / "recordings").is_dir()
    assert (content / "autoruns").is_dir()
    assert (content / "fresh").is_dir()
