from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import async_sessionmaker

from src.storage.models import Resolver, ResolverInterface, Source, ResolverContext
from src.startup.ensure_plugins import load_plugin_jit, sync_plugins_db


def get_validated_config(
    resolvers_dir: Path, origin: str, expected_hash: str, data: dict[str, Any]
) -> BaseModel:
    resolver = load_resolver_jit(resolvers_dir, origin, expected_hash)
    return resolver.config_model(**data)


def load_resolver_jit(resolvers_dir: Path, origin: str, expected_hash: str) -> ResolverInterface:
    """Stateless JIT loader for a specific resolver."""
    return load_plugin_jit(resolvers_dir, origin, expected_hash, ResolverInterface, "resolver")


def _extract_db_fields(instance: ResolverInterface, module_hash: str) -> dict[str, Any]:
    return {
        "name": instance.name,
        "description": instance.description,
        "origin": instance.name,
        "origin_hash": module_hash,
        "config_schema": instance.config_model.model_json_schema(),
    }


def _schema_changed(instance: ResolverInterface, existing: Resolver | None, module_hash: str) -> bool:
    if existing is None:
        return False
    new_schema = instance.config_model.model_json_schema()
    return (
        existing.origin_hash != module_hash
        or existing.config_schema != new_schema
        or bool(existing.config_schema == {} and new_schema.get("properties"))
    )


async def sync_resolvers_db(resolvers_dir: Path, session_factory: async_sessionmaker) -> None:
    """Syncs filesystem resolver plugins to DB. Call this at app startup."""
    await sync_plugins_db(
        plugin_dir=resolvers_dir,
        model_type=Resolver,
        interface_type=ResolverInterface,
        extract_db_fields=_extract_db_fields,
        schema_changed=_schema_changed,
        plugin_label="resolver",
        session_factory=session_factory,
    )
