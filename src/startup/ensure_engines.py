from __future__ import annotations

from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import async_sessionmaker

from src.storage.models import Engine
from src.plugins.interfaces import EngineInterface, Capabilities
from src.plugins.retry import build_retry_modes_schema
from src.startup.ensure_plugins import load_plugin_jit, sync_plugins_db


def load_engine_jit(engines_dir: Path, origin: str, expected_hash: str) -> EngineInterface:
    """Stateless JIT loader for a specific engine."""
    return load_plugin_jit(engines_dir, origin, expected_hash, EngineInterface, "engine")


def _extract_db_fields(instance: EngineInterface, module_hash: str) -> dict[str, Any]:
    return {
        "name": instance.name,
        "description": instance.description,
        "capabilities": instance.capabilities,
        "origin": instance.name,
        "origin_hash": module_hash,
        "retry_modes_schema": build_retry_modes_schema(instance.retry_modes),
    }


def _schema_changed(instance: EngineInterface, existing: Engine | None, module_hash: str) -> bool:
    if existing is None:
        return False
    new_schema = build_retry_modes_schema(instance.retry_modes)
    return (
        existing.origin_hash != module_hash
        or existing.retry_modes_schema != new_schema
        or bool(existing.retry_modes_schema == {} and new_schema)
    )


async def sync_engines_db(engines_dir: Path, session_factory: async_sessionmaker) -> None:
    """Syncs filesystem engine plugins to DB. Call this at app startup."""
    await sync_plugins_db(
        plugin_dir=engines_dir,
        model_type=Engine,
        interface_type=EngineInterface,
        extract_db_fields=_extract_db_fields,
        schema_changed=_schema_changed,
        plugin_label="engine",
        session_factory=session_factory,
    )
