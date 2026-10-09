"""Companion processes — long-lived helpers a resolver needs.

A resolver that cannot hand the engine a usable ``Source`` on its own (say, an
HLS proxy that unwraps image-wrapped segments) declares a :class:`CompanionSpec`.
The process is spawned once, shared by every session whose spec matches (same
class, same code, same config), and kept alive by a lease each session holds.
It self-reaps once no lease has been held for ``IDLE_TTL`` seconds, so a crashed
session cannot leak one.

The base owns only the standardized surface: ``/health``, the identity probe
``/__companion__``, and the ``/__companion__/lease`` keep-alive. Subclasses
implement ``handle`` for their content routes and are launched as
``python <their module file> --mirrorr-companion <name> ...``.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import sys
import threading
import time
import urllib.parse
from abc import ABC, abstractmethod
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, ClassVar

from pydantic import BaseModel

MARKER = "--mirrorr-companion"


@dataclass
class CompanionSpec:
    """A resolver's declaration that it needs a companion process.

    ``config`` is the session-independent part of the resolver config: two
    resolvers declaring the same class + config share one process.
    """

    companion: type["Companion"]
    config: BaseModel


def sibling(module_file: str, name: str) -> Any:
    """Import ``<name>.py`` next to a JIT-loaded plugin.

    Plugins are loaded by path, not as a package, so a resolver cannot
    ``from . import`` its companion module. Re-executed on every call so a
    redeploy picks up the new source.
    """
    path = Path(module_file).with_name(f"{name}.py")
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _source_hash(cls: type) -> str:
    return hashlib.sha256(Path(sys.modules[cls.__module__].__file__).read_bytes()).hexdigest()


class Companion(ABC):
    """Base for a companion process. See the module docstring."""

    name: ClassVar[str]
    config_model: ClassVar[type[BaseModel]]
    IDLE_TTL: ClassVar[float] = 30.0

    def __init__(self, config: BaseModel, host: str, port: int) -> None:
        self.config = config
        self.host = host
        self.port = port
        self.started_at = time.time()
        self.code_hash = _source_hash(type(self))
        self._leases = 0
        self._idle_since = time.time()

    # ── contract ──────────────────────────────────────────────────────

    @abstractmethod
    def handle(self, req: BaseHTTPRequestHandler, path: str, query: dict[str, list[str]]) -> None:
        """Serve a content request (the base owns /health + /__companion__*)."""
        ...

    def identity(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "pid": os.getpid(),
            "port": self.port,
            "started_at": self.started_at,
            "code_hash": self.code_hash,
            "config": json.loads(self.config.model_dump_json()),
        }

    @classmethod
    def source_hash(cls) -> str:
        return _source_hash(cls)

    @classmethod
    def script_path(cls) -> Path:
        return Path(sys.modules[cls.__module__].__file__)

    # ── lease + self-reap ─────────────────────────────────────────────

    def lease(self, req: BaseHTTPRequestHandler) -> None:
        """Hold the connection open until the client closes it."""
        self._leases += 1
        req.send_response(200)
        req.send_header("Content-Type", "text/plain")
        req.send_header("Content-Length", "1")
        req.end_headers()
        req.wfile.write(b"\n")
        req.wfile.flush()
        try:
            while req.connection.recv(1):
                pass
        except OSError:
            pass
        finally:
            self._leases -= 1
            self._idle_since = time.time()

    def _reap(self, server: ThreadingHTTPServer) -> None:
        while True:
            time.sleep(1.0)
            if self._leases == 0 and time.time() - self._idle_since > self.IDLE_TTL:
                server.shutdown()
                return

    # ── entrypoint ────────────────────────────────────────────────────

    def serve(self) -> None:
        handler = type("Handler", (_Handler,), {"companion": self})
        server = ThreadingHTTPServer((self.host, self.port), handler)
        server.daemon_threads = True
        threading.Thread(target=self._reap, args=(server,), daemon=True).start()
        print(f"{self.name} on http://{self.host}:{self.port}", flush=True)
        server.serve_forever()

    @classmethod
    def main(cls) -> None:
        parser = argparse.ArgumentParser(prog=cls.name)
        parser.add_argument(MARKER, dest="marker")
        parser.add_argument("--host", default="127.0.0.1")
        parser.add_argument("--port", type=int, required=True)
        parser.add_argument("--config", default="{}")
        args = parser.parse_args()
        cls(cls.config_model.model_validate_json(args.config), args.host, args.port).serve()


class _Handler(BaseHTTPRequestHandler):
    companion: ClassVar[Companion]
    server_version = "mirrorr-companion"

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        url = urllib.parse.urlparse(self.path)
        if url.path == "/health":
            return self.send(200, b"ok", "text/plain")
        if url.path == "/__companion__":
            body = json.dumps(self.companion.identity()).encode()
            return self.send(200, body, "application/json")
        if url.path == "/__companion__/lease":
            return self.companion.lease(self)
        return self.companion.handle(self, url.path, urllib.parse.parse_qs(url.query))
