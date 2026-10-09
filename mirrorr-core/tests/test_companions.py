from __future__ import annotations

import asyncio
import json
import time
import urllib.request

import pytest
from pydantic import BaseModel

from mirrorr.plugins.companion import Companion, CompanionSpec, sibling
from mirrorr.plugins.interfaces import ResolverContext, ResolverInterface, Source
from mirrorr.services.companions import acquire, scan
from mirrorr.startup.ensure_resolvers import _companion_validator

_ECHO_MODULE = '''\
from pydantic import BaseModel

from mirrorr.plugins.companion import Companion


class EchoConfig(BaseModel):
    greeting: str = "hi"


class EchoCompanion(Companion):
    name = "echo-companion"
    config_model = EchoConfig
    IDLE_TTL = 1.0

    def handle(self, req, path, query):
        if path == "/echo":
            return req.send(200, self.config.greeting.encode(), "text/plain")
        req.send(404, b"nope", "text/plain")


if __name__ == "__main__":
    EchoCompanion.main()
'''


class _Cfg(BaseModel):
    pass


class _Comp(Companion):
    name = "shared"
    config_model = _Cfg

    def handle(self, req, path, query):  # pragma: no cover - never served
        req.send(404, b"", "text/plain")


class _Res(ResolverInterface[_Cfg]):
    def __init__(self, name: str, companion: CompanionSpec | None) -> None:
        self._name = name
        self._companion = companion

    @property
    def name(self) -> str:
        return self._name

    @property
    def description(self) -> str:
        return ""

    @property
    def config_model(self) -> type[_Cfg]:
        return _Cfg

    @property
    def companion(self) -> CompanionSpec | None:
        return self._companion

    async def resolve(self, config: _Cfg, context: ResolverContext) -> Source:
        return Source(url="u")


def test_sibling_loads_sibling_module(tmp_path):
    (tmp_path / "mod_a.py").write_text("VALUE = 42\n")
    assert sibling(str(tmp_path / "loader.py"), "mod_a").VALUE == 42


def test_companion_names_must_be_unique():
    validate = _companion_validator()
    spec = CompanionSpec(_Comp, _Cfg())
    validate(_Res("a", spec))
    with pytest.raises(ValueError, match="unique"):
        validate(_Res("b", spec))


def test_companion_validator_ignores_resolvers_without_a_companion():
    validate = _companion_validator()
    validate(_Res("a", None))
    validate(_Res("b", None))


def _get(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=3) as resp:
        return resp.read()


def test_acquire_spawns_reuses_and_reaps(tmp_path):
    (tmp_path / "echo_companion.py").write_text(_ECHO_MODULE)
    mod = sibling(str(tmp_path / "loader.py"), "echo_companion")
    spec = CompanionSpec(mod.EchoCompanion, mod.EchoConfig(greeting="yo"))
    logs = tmp_path / "companions"

    async def scenario():
        url, lease = await acquire(spec, logs)
        try:
            info = json.loads(_get(f"{url}/__companion__"))
            assert info["name"] == "echo-companion"
            assert _get(f"{url}/echo") == b"yo"

            # A second acquire reuses the same process.
            url2, lease2 = await acquire(spec, logs)
            lease2.close()
            assert url2 == url
            assert json.loads(_get(f"{url2}/__companion__"))["pid"] == info["pid"]
        finally:
            lease.close()

        # With no lease held it self-reaps.
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            alive = [c for c in await asyncio.to_thread(scan) if c["name"] == "echo-companion"]
            if not alive:
                return
            await asyncio.sleep(0.5)
        raise AssertionError("companion did not reap after its lease closed")

    asyncio.run(scenario())
