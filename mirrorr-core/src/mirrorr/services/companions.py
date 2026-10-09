"""Companion process discovery, spawning, and leasing.

A companion is a standalone program (see ``mirrorr.plugins.companion``) shared
by resolvers. Rather than a registry — which would re-introduce the
synchronization drift the declaration model had — the live process table is the
source of truth: :func:`scan` finds running companions by their marker, and
:func:`acquire` reuses a matching one or spawns it. A spawn race is arbitrated
filelessly by lowest pid.
"""

from __future__ import annotations

import asyncio
import json
import socket
import sys
import time
import urllib.request
from pathlib import Path

from loguru import logger
from psutil import process_iter

from mirrorr.plugins.companion import MARKER, CompanionSpec
from mirrorr.services.managed_process import ManagedProcess


class Lease:
    """Holds a companion alive for as long as it is open."""

    def __init__(self, sock: socket.socket) -> None:
        self._sock: socket.socket | None = sock

    def close(self) -> None:
        if self._sock is not None:
            try:
                self._sock.close()
            except OSError:
                pass
            self._sock = None


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


def _open_lease(url: str) -> Lease:
    host, _, port = url.removeprefix("http://").partition(":")
    sock = socket.create_connection((host, int(port)), timeout=5)
    sock.sendall(
        f"GET /__companion__/lease HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: keep-alive\r\n\r\n".encode()
    )
    sock.recv(1)  # the response byte proves the lease is held
    return Lease(sock)


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


async def _wait_health(port: int, proc: ManagedProcess, timeout: float = 10.0) -> bool:
    url = f"http://127.0.0.1:{port}/health"
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if proc.returncode is not None:
            return False
        try:
            with urllib.request.urlopen(url, timeout=1) as resp:
                if resp.read().strip() == b"ok":
                    return True
        except Exception:
            pass
        await asyncio.sleep(0.2)
    return False


async def acquire(spec: CompanionSpec, companions_dir: Path) -> tuple[str, Lease]:
    """Return ``(base_url, lease)`` for the companion matching ``spec``.

    Reuses a running instance when one matches; otherwise spawns it and
    arbitrates any race by keeping the lowest pid.
    """
    companion = spec.companion
    config = json.loads(spec.config.model_dump_json())
    key = _key(companion.name, companion.source_hash(), config)

    for info in await asyncio.to_thread(scan):
        if _key(info["name"], info["code_hash"], info["config"]) == key:
            logger.opt(colors=True).info(
                f"Reusing companion <b><yellow>{companion.name}</yellow></b> (pid {info['pid']})"
            )
            return info["url"], _open_lease(info["url"])

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
        raise RuntimeError(f"Companion {companion.name} failed to start")

    for info in await asyncio.to_thread(scan):
        if _key(info["name"], info["code_hash"], info["config"]) == key and info["pid"] < proc.pid:
            logger.info(f"Companion {companion.name} spawn race: keeping pid {info['pid']}")
            await proc.kill()
            await proc.close()
            return info["url"], _open_lease(info["url"])

    url = f"http://127.0.0.1:{port}"
    logger.opt(colors=True).success(f"Started companion <green>{companion.name}</green> at {url}")
    return url, _open_lease(url)
