"""Session-level telemetry: one coalesced frame from per-process samples.

Every ``ManagedProcess`` samples itself at 1 Hz onto the in-process bus as
``proc.<name>.telemetry``. The supervisor keeps the newest sample per process
and publishes a single ``session.<id>.telemetry`` frame per tick — one NATS
message per session instead of one per process per second — which the console
renders as the live process readout.
"""

from __future__ import annotations

from typing import Any

PUBLISH_INTERVAL_S = 1.0

SAMPLE_FIELDS = ("cpu_percent", "rss_bytes", "vms_bytes")


def record_sample(samples: dict[str, dict[str, Any]], name: str, sample: dict[str, Any]) -> None:
    """Keep the newest sample for *name*, restricted to the published fields."""
    entry = {field: sample[field] for field in SAMPLE_FIELDS if field in sample}
    if entry:
        samples[name] = entry


def build_frame(session_id: int, samples: dict[str, dict[str, Any]], ts: float) -> dict[str, Any] | None:
    """Coalesce *samples* into one frame, or ``None`` when nothing was sampled."""
    if not samples:
        return None
    processes = [{"name": name, **samples[name]} for name in sorted(samples)]
    return {
        "session_id": session_id,
        "ts": ts,
        "processes": processes,
        "total_rss_bytes": sum(int(process.get("rss_bytes", 0)) for process in processes),
    }
