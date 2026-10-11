"""Companion process discovery, spawning, and leasing.

A companion is a standalone program (see ``mirrorr.plugin_api.companion``) shared
by resolvers. Rather than a registry — which would re-introduce the
synchronization drift the declaration model had — the live process table is the
source of truth: :func:`scan` finds running companions by their marker, and
:func:`acquire` reuses a matching one or spawns it. A spawn race is arbitrated
filelessly by lowest pid.

A lease is a shared ``flock`` on the companion's lock file (see
``mirrorr.plugin_api.companion``): the kernel owns the holder count, so it
cannot drift, and it drops the lock if a holder dies.
"""

from __future__ import annotations

import asyncio
import fcntl
import hashlib
import json
import os
import socket
import sys
import time
import urllib.request
from pathlib import Path

from loguru import logger
from psutil import process_iter

from mirrorr.plugin_api.companion import MARKER, CompanionSpec
from mirrorr.services.managed_process import ManagedProcess


class Lease:
    """Holds a companion alive by keeping a shared lock on its lock file.

    Closing the fd (or the process dying) releases the kernel's lock, so the
    companion reaps once the last holder is gone.
    """

    def __init__(self, fd: int) -> None:
        self._fd: int | None = fd

    def close(self) -> None:
        if self._fd is not None:
            os.close(self._fd)
            self._fd = None

    def __del__(self) -> None:
        self.close()


def _key(name: str, code_hash: str, config: dict) -> tuple[str, str, str]:
    return (name, code_hash, json.dumps(config, sort_keys=True))


def _probe(url: str) -> dict | None:
    try:
        with urllib.request.urlopen(f"{url}/__companion__", timeout=2) as resp:
            return json.loads(resp.read())
    except Exception:
        return None


def scan() -> list[dict]:
    """Return the identity of every running companion, via the process table."""
    found: list[dict] = []
    for proc in process_iter(["pid", "cmdline"]):
        cmd = proc.info.get("cmdline") or []
        if MARKER not in cmd:
            continue
        try:
            port = int(cmd[cmd.index("--port") + 1])
        except (ValueError, IndexError):
            continue
        url = f"http://127.0.0.1:{port}"
        info = _probe(url)
        if info and info.get("pid") == proc.info["pid"]:
            info["url"] = url
            found.append(info)
    return found


def _lock_path(companions_dir: Path, name: str, code_hash: str, config: dict) -> Path:
    """The lock file a companion and its sessions share."""
    ident = json.dumps([name, code_hash, config], sort_keys=True).encode()
    return companions_dir / f"{name}-{hashlib.sha256(ident).hexdigest()[:12]}.lock"


def _open_lease(url: str, lock_path: Path) -> Lease | None:
    """Take a shared lock on ``lock_path``, or None if the companion is gone.

    A shared lock is refused only while the companion holds the exclusive lock
    (it is reaping); the identity probe then confirms it is actually serving.
    """
    try:
        fd = os.open(lock_path, os.O_RDWR)
    except OSError:
        return None
    try:
        fcntl.flock(fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(fd)
        return None
    if _probe(url) is None:
        os.close(fd)
        return None
    return Lease(fd)


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _health_ok(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=1) as resp:
            return resp.read().strip() == b"ok"
    except Exception:
        return False


async def _wait_health(port: int, proc: ManagedProcess, timeout: float = 10.0) -> bool:
    url = f"http://127.0.0.1:{port}/health"
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if proc.returncode is not None:
            return False
        if await asyncio.to_thread(_health_ok, url):
            return True
        await asyncio.sleep(0.2)
    return False


async def acquire(spec: CompanionSpec, companions_dir: Path) -> tuple[str, Lease]:
    """Return ``(base_url, lease)`` for the companion matching ``spec``.

    Reuses a running instance when one matches; otherwise spawns it and
    arbitrates any race by keeping the lowest pid. A companion that is reaping
    refuses the lease, so a few attempts absorb the handover to a fresh process.
    """
    companion = spec.companion
    config = json.loads(spec.config.model_dump_json())
    key = _key(companion.name, companion.source_hash(), config)
    lock_path = _lock_path(companions_dir, companion.name, companion.source_hash(), config)

    for _ in range(4):
        for info in await asyncio.to_thread(scan):
            if _key(info["name"], info["code_hash"], info["config"]) == key:
                lease = await asyncio.to_thread(_open_lease, info["url"], lock_path)
                if lease is not None:
                    logger.opt(colors=True).info(
                        f"Reusing companion <b><yellow>{companion.name}</yellow></b> (pid {info['pid']})"
                    )
                    return info["url"], lease

        companions_dir.mkdir(parents=True, exist_ok=True)
        script = companion.script_path()
        proc: ManagedProcess | None = None
        port = 0
        for _ in range(3):
            port = _free_port()
            proc = ManagedProcess(
                name=f"companion:{companion.name}",
                command=[
                    sys.executable, str(script), MARKER, companion.name,
                    "--port", str(port), "--config", spec.config.model_dump_json(),
                    "--lock", str(lock_path),
                ],
            )
            proc.set_log_dir(companions_dir)
            await proc.start()
            if await _wait_health(port, proc):
                break
            logger.warning(f"Companion {companion.name} failed to bind :{port}, retrying")
            await proc.kill()
            await proc.close()
            proc = None
        if proc is None:
            await asyncio.sleep(0.25)
            continue

        url = f"http://127.0.0.1:{port}"
        for info in await asyncio.to_thread(scan):
            if _key(info["name"], info["code_hash"], info["config"]) == key and info["pid"] < proc.pid:
                lease = await asyncio.to_thread(_open_lease, info["url"], lock_path)
                if lease is not None:
                    logger.info(f"Companion {companion.name} spawn race: keeping pid {info['pid']}")
                    await proc.kill()
                    await proc.close()
                    return info["url"], lease

        lease = await asyncio.to_thread(_open_lease, url, lock_path)
        if lease is not None:
            logger.opt(colors=True).success(f"Started companion <green>{companion.name}</green> at {url}")
            return url, lease
        await proc.kill()
        await proc.close()
        await asyncio.sleep(0.25)

    raise RuntimeError(f"Companion {companion.name} failed to start")
