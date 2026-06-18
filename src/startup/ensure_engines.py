from __future__ import annotations

import hashlib
import importlib.util
import inspect
from pathlib import Path
from typing import Any

from loguru import logger
from sqlalchemy.ext.asyncio import async_sessionmaker

from src.storage.models import Engine, EngineInterface, Capabilities
from src.storage import crud


def load_engine_jit(engines_dir: Path, origin: str, expected_hash: str) -> EngineInterface:
    """Stateless JIT loader for a specific engine."""
    file_path = engines_dir / f"{origin}.py"

    current_hash = hashlib.sha256(file_path.read_bytes()).hexdigest()
    if current_hash != expected_hash:
        raise RuntimeError(f"Hash mismatch for engine {origin}")

    spec = importlib.util.spec_from_file_location(origin, file_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Could not load spec for {origin}")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    for attr_name in dir(module):
        attr = getattr(module, attr_name)
        if inspect.isclass(attr) and issubclass(attr, EngineInterface) and attr is not EngineInterface:
            return attr()

    raise ValueError(f"No valid EngineInterface implementation found in {origin}")


async def sync_engines_db(engines_dir: Path, session_factory: async_sessionmaker) -> None:
    """Syncs filesystem plugins to DB. Call this at app startup."""
    logger.info("Syncing engines from filesystem...")
    async with session_factory() as session:
        db_engines = {e.name: e for e in await crud.get_all(session, Engine)}

        for file_path in engines_dir.glob("*.py"):
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
                logger.error(f"Failed to load engine module {file_path}: {e}")
                continue

            for attr_name in dir(module):
                attr = getattr(module, attr_name)

                if inspect.isclass(attr) and issubclass(attr, EngineInterface) and attr is not EngineInterface:
                    try:
                        engine_instance = attr()
                        logger.opt(colors=True).info(
                            f"Loaded engine: <b><yellow>{engine_instance.name}</yellow></b> "
                            f"from <b><yellow>{file_path.name}</yellow></b>"
                        )

                        module_hash = hashlib.sha256(file_path.read_bytes()).hexdigest()
                        existing_engine = db_engines.get(engine_instance.name)

                        if existing_engine is None:
                            new_db_engine = Engine(
                                name=engine_instance.name,
                                description=engine_instance.description,
                                capabilities=engine_instance.capabilities,
                                origin=module_name,
                                origin_hash=module_hash,
                            )
                            await crud.create(session, new_db_engine)
                            db_engines[engine_instance.name] = new_db_engine
                            logger.info(f"Engine {engine_instance.name} saved to database")

                        elif existing_engine.origin_hash != module_hash:
                            updated_db_engine = Engine(
                                id=existing_engine.id,
                                name=engine_instance.name,
                                description=engine_instance.description,
                                capabilities=engine_instance.capabilities,
                                origin=module_name,
                                origin_hash=module_hash,
                            )
                            await crud.update(session, Engine, existing_engine.id, updated_db_engine)
                            updated_db_engine.id = existing_engine.id
                            db_engines[engine_instance.name] = updated_db_engine
                            logger.opt(colors=True).info(
                                f"The hash for the engine <b><yellow>{engine_instance.name}</yellow></b> "
                                f"<b>changed</b>, updated its database entry"
                            )

                        else:
                            logger.opt(colors=True).info(
                                f"Engine <b><yellow>{engine_instance.name}</yellow></b> "
                                f"<b>already exists</b> in database with the <b>same hash</b>"
                            )

                    except TypeError as e:
                        logger.error(f"Could not instantiate {attr_name}: {e}. (Is it abstract?)")

            await session.commit()

        # Remove stale DB entries whose origin no longer exists on disk
        existing_origins = {fp.stem for fp in engines_dir.glob("*.py") if not fp.name.startswith("_")}
        for engine in list(db_engines.values()):
            if engine.origin not in existing_origins:
                logger.info(f"Removing stale engine entry: {engine.name} (origin={engine.origin})")
                await crud.delete(session, Engine, engine.id)

    logger.info("Engines successfully initialized and synced with database.")
