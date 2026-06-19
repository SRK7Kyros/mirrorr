"""Generic plugin sync: filesystem ↔ DB.

Both ensure_engines and ensure_resolvers share the same structure:
load module → hash → compare → create/update/delete. This module
extracts that common logic.
"""

from __future__ import annotations

import hashlib
import importlib.util
import inspect
from pathlib import Path
from typing import Any, Callable, TypeVar

from loguru import logger
from sqlmodel import SQLModel
from sqlalchemy.ext.asyncio import async_sessionmaker

from src.storage import crud

T = TypeVar("T", bound=SQLModel)


def _hash_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_plugin_jit(
    plugin_dir: Path,
    origin: str,
    expected_hash: str,
    interface_type: type,
    plugin_label: str,
) -> Any:
    """Stateless JIT loader for a specific plugin."""
    file_path = plugin_dir / f"{origin}.py"

    current_hash = _hash_file(file_path)
    if current_hash != expected_hash:
        raise RuntimeError(f"Hash mismatch for {plugin_label} {origin}")

    spec = importlib.util.spec_from_file_location(origin, file_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Could not load spec for {origin}")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    for attr_name in dir(module):
        attr = getattr(module, attr_name)
        if (
            inspect.isclass(attr)
            and issubclass(attr, interface_type)
            and attr is not interface_type
        ):
            return attr()

    raise ValueError(f"No valid {interface_type.__name__} implementation found in {origin}")


async def sync_plugins_db(
    plugin_dir: Path,
    model_type: type[T],
    interface_type: type,
    extract_db_fields: Callable[[Any, str], dict[str, Any]],
    schema_changed: Callable[[Any, T | None, str], bool],
    plugin_label: str,
    session_factory: async_sessionmaker,
) -> None:
    """Sync filesystem plugins to DB. Call at app startup.

    Args:
        plugin_dir: Directory containing plugin .py files.
        model_type: SQLModel class for the DB table.
        interface_type: ABC class that plugins implement.
        extract_db_fields: (instance, module_hash) → dict of fields for model constructor.
        schema_changed: (instance, existing_db_row, module_hash) → True if DB needs update.
        plugin_label: Human-readable label for log messages (e.g. "engine", "resolver").
        session_factory: Async session factory.
    """
    logger.info(f"Syncing {plugin_label}s from filesystem...")
    async with session_factory() as session:
        db_items = {item.name: item for item in await crud.get_all(session, model_type)}  # ty:ignore[unresolved-attribute]

        for file_path in plugin_dir.glob("*.py"):
            if file_path.name.startswith("_"):
                continue

            module_name = file_path.stem
            spec = importlib.util.spec_from_file_location(module_name, file_path)
            if spec is None or spec.loader is None:
                logger.warning(f"Could not create module spec for {file_path}")
                continue

            module = importlib.util.module_from_spec(spec)
            try:
                spec.loader.exec_module(module)
            except Exception as e:
                logger.error(f"Failed to load {plugin_label} module {file_path}: {e}")
                continue

            for attr_name in dir(module):
                attr = getattr(module, attr_name)
                if (
                    inspect.isclass(attr)
                    and issubclass(attr, interface_type)
                    and attr is not interface_type
                ):
                    try:
                        instance = attr()
                        logger.opt(colors=True).info(
                            f"Loaded {plugin_label}: <b><yellow>{instance.name}</yellow></b> "
                            f"from <b><yellow>{file_path.name}</yellow></b>"
                        )

                        module_hash = _hash_file(file_path)
                        existing = db_items.get(instance.name)
                        fields = extract_db_fields(instance, module_hash)

                        if existing is None:
                            new_obj = model_type(**fields)
                            await crud.create(session, new_obj)
                            db_items[instance.name] = new_obj
                            logger.info(f"{plugin_label.capitalize()} {instance.name} saved to database")

                        elif schema_changed(instance, existing, module_hash):
                            updated_obj = model_type(id=existing.id, **fields)  # ty:ignore[unresolved-attribute]
                            await crud.update(session, model_type, existing.id, updated_obj)  # ty:ignore[unresolved-attribute]
                            updated_obj.id = existing.id  # ty:ignore[unresolved-attribute]
                            db_items[instance.name] = updated_obj
                            logger.opt(colors=True).info(
                                f"The hash for the {plugin_label} <b><yellow>{instance.name}</yellow></b> "
                                f"<b>changed</b>, updated its database entry"
                            )

                        else:
                            logger.opt(colors=True).info(
                                f"{plugin_label.capitalize()} <b><yellow>{instance.name}</yellow></b> "
                                f"<b>already exists</b> in database with the <b>same hash</b>"
                            )

                    except TypeError as e:
                        logger.error(f"Could not instantiate {attr_name}: {e}. (Is it abstract?)")

            await session.commit()

        # Remove stale DB entries whose origin no longer exists on disk
        existing_origins = {fp.stem for fp in plugin_dir.glob("*.py") if not fp.name.startswith("_")}
        for item in list(db_items.values()):
            if item.origin not in existing_origins:  # ty:ignore[unresolved-attribute]
                logger.info(f"Removing stale {plugin_label} entry: {item.name} (origin={item.origin})")  # ty:ignore[unresolved-attribute]
                await crud.delete(session, model_type, item.id)  # ty:ignore[unresolved-attribute]

    logger.info(f"{plugin_label.capitalize()}s successfully initialized and synced with database.")
