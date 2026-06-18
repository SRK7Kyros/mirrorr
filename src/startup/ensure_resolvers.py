from __future__ import annotations

import hashlib
import importlib.util
import inspect
from pathlib import Path
from typing import Any

from loguru import logger
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import async_sessionmaker

from src.storage.models import Resolver, ResolverInterface, Source, ResolverContext
from src.storage import crud


def get_validated_config(
    resolvers_dir: Path, origin: str, expected_hash: str, data: dict[str, Any]
) -> BaseModel:
    resolver = load_resolver_jit(resolvers_dir, origin, expected_hash)
    return resolver.config_model(**data)


def load_resolver_jit(resolvers_dir: Path, origin: str, expected_hash: str) -> ResolverInterface:
    """Stateless JIT loader for a specific resolver."""
    file_path = resolvers_dir / f"{origin}.py"

    current_hash = hashlib.sha256(file_path.read_bytes()).hexdigest()
    if current_hash != expected_hash:
        raise RuntimeError(f"Hash mismatch for resolver {origin}")

    spec = importlib.util.spec_from_file_location(origin, file_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Could not load spec for {origin}")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    for attr_name in dir(module):
        attr = getattr(module, attr_name)
        if inspect.isclass(attr) and issubclass(attr, ResolverInterface) and attr is not ResolverInterface:
            return attr()

    raise ValueError(f"No valid ResolverInterface implementation found in {origin}")


async def sync_resolvers_db(resolvers_dir: Path, session_factory: async_sessionmaker) -> None:
    """Syncs filesystem plugins to DB. Call this at app startup."""
    logger.info("Syncing resolvers from filesystem...")
    async with session_factory() as session:
        db_resolvers = {e.name: e for e in await crud.get_all(session, Resolver)}

        for file_path in resolvers_dir.glob("*.py"):
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
                logger.error(f"Failed to load resolver module {file_path}: {e}")
                continue

            for attr_name in dir(module):
                attr = getattr(module, attr_name)
                if inspect.isclass(attr) and issubclass(attr, ResolverInterface) and attr is not ResolverInterface:
                    try:
                        resolver_instance = attr()
                        logger.opt(colors=True).info(
                            f"Loaded resolver: <b><yellow>{resolver_instance.name}</yellow></b> "
                            f"from <b><yellow>{file_path.name}</yellow></b>"
                        )

                        module_hash = hashlib.sha256(file_path.read_bytes()).hexdigest()
                        existing_resolver = db_resolvers.get(resolver_instance.name)

                        if existing_resolver is None:
                            new_db_resolver = Resolver(
                                name=resolver_instance.name,
                                description=resolver_instance.description,
                                origin=module_name,
                                origin_hash=module_hash,
                            )
                            await crud.create(session, new_db_resolver)
                            db_resolvers[resolver_instance.name] = new_db_resolver
                            logger.info(f"Resolver {resolver_instance.name} saved to database")

                        elif existing_resolver.origin_hash != module_hash:
                            updated_db_resolver = Resolver(
                                id=existing_resolver.id,
                                name=resolver_instance.name,
                                description=resolver_instance.description,
                                origin=module_name,
                                origin_hash=module_hash,
                            )
                            await crud.update(session, Resolver, existing_resolver.id, updated_db_resolver)
                            updated_db_resolver.id = existing_resolver.id
                            db_resolvers[resolver_instance.name] = updated_db_resolver
                            logger.opt(colors=True).info(
                                f"The hash for the resolver <b><yellow>{resolver_instance.name}</yellow></b> "
                                f"<b>changed</b>, updated its database entry"
                            )

                        else:
                            logger.opt(colors=True).info(
                                f"Resolver <b><yellow>{resolver_instance.name}</yellow></b> "
                                f"<b>already exists</b> in database with the <b>same hash</b>"
                            )
                    except TypeError as e:
                        logger.error(f"Could not instantiate {attr_name}: {e}. (Is it abstract?)")

            await session.commit()

        # Remove stale DB entries whose origin no longer exists on disk
        existing_origins = {fp.stem for fp in resolvers_dir.glob("*.py") if not fp.name.startswith("_")}
        for resolver in list(db_resolvers.values()):
            if resolver.origin not in existing_origins:
                logger.info(f"Removing stale resolver entry: {resolver.name} (origin={resolver.origin})")
                await crud.delete(session, Resolver, resolver.id)

    logger.info("Resolvers successfully initialized and synced with database.")
