from mirrorr.startup.config import MirrorrSettings
from mirrorr.startup.ensure_db import ensure_db
from mirrorr.startup.ensure_ffmpeg import ensure_ffmpeg
from mirrorr.startup.ensure_nats_server import NatsServerManager
from mirrorr.startup.ensure_engines import sync_engines_db, load_engine_jit
from mirrorr.startup.ensure_resolvers import sync_resolvers_db, load_resolver_jit
from mirrorr.startup.logging import setup_logging

# NOTE: api_bootstrap is intentionally NOT imported here to avoid a
# circular import (startup.__init__ → api_bootstrap → api.api → database
# → startup.__init__).  Import it directly when needed:
#   from mirrorr.startup.api_bootstrap import run_api_server

def run_api_server(*args, **kwargs):
    from mirrorr.startup.api_bootstrap import run_api_server as _run
    return _run(*args, **kwargs)

__all__ = [
    "MirrorrSettings",
    "ensure_db",
    "ensure_ffmpeg",
    "NatsServerManager",
    "sync_engines_db",
    "load_engine_jit",
    "sync_resolvers_db",
    "load_resolver_jit",
    "run_api_server",
    "setup_logging",
]
