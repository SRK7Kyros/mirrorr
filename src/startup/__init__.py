from src.startup.config import MirrorrSettings
from src.startup.ensure_db import ensure_db
from src.startup.ensure_ffmpeg import ensure_ffmpeg
from src.startup.ensure_nats_server import NatsServerManager
from src.startup.ensure_engines import sync_engines_db, load_engine_jit
from src.startup.ensure_resolvers import sync_resolvers_db, load_resolver_jit
from src.startup.logging import setup_logging

# NOTE: api_bootstrap is intentionally NOT imported here to avoid a
# circular import (startup.__init__ → api_bootstrap → api.api → database
# → startup.__init__).  Import it directly when needed:
#   from src.startup.api_bootstrap import run_api_server

def run_api_server(*args, **kwargs):
    from src.startup.api_bootstrap import run_api_server as _run
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
