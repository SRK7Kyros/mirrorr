"""Regression for the SQLite schema-rebuild FK defect.

`_rebuild_table_sqlite` used to `ALTER TABLE <t> RENAME TO _old_<t>`, which on
SQLite >= 3.25 with `PRAGMA foreign_keys=ON` rewrites every *child* table's FK to
point at the renamed table. The closing `DROP TABLE _old_<t>` then runs an
implicit DELETE and trips the FK check while child rows still reference it.

These tests drive the real `create_db_engine` (so `PRAGMA foreign_keys=ON` is
genuinely in force) and the real `ensure_db`, seeding the sibling rows through
the real models so the FK genuinely exists.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from sqlalchemy import MetaData, Table, inspect, text
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker
from sqlmodel import SQLModel

from mirrorr.startup.config import MirrorrSettings
from mirrorr.startup.ensure_db import ensure_db
from mirrorr.storage.database import create_db_engine
from mirrorr.storage.models import Engine as EngineModel
from mirrorr.storage.models import Profile, Resolver, ResolverSource, Session


def _stale_resolver_table() -> Table:
    """The `resolvers` table as an old ADD COLUMN left it: `has_catalog` nullable."""
    stale = Resolver.__table__.to_metadata(MetaData())
    stale.c.has_catalog.nullable = True
    return stale


async def _engine_with_stale_resolvers(
    tmp_path: Path,
) -> tuple[AsyncEngine, async_sessionmaker]:
    engine, maker = create_db_engine(MirrorrSettings(base_dir=tmp_path))
    async with engine.begin() as conn:
        # A pre-existing `resolvers` whose `has_catalog` is nullable; create_all
        # (checkfirst) then skips it and builds every other table around it.
        await conn.run_sync(lambda sync_conn: _stale_resolver_table().create(sync_conn))
        await conn.run_sync(SQLModel.metadata.create_all)
    return engine, maker


async def _seed(maker: async_sessionmaker, *, with_children: bool) -> None:
    async with maker() as db:
        db.add(Resolver(id=1, name="r", description="d", origin="o", origin_hash="h", has_catalog=True))
        db.add(EngineModel(id=1, name="e", origin="o", origin_hash="h"))
        await db.commit()
        if with_children:
            db.add(Profile(id=1, name="p", default_engine_id=1, resolver_id=1))
            db.add(Session(id=1, engine_id=1, resolver_id=1, requester_user_token="u"))
            db.add(ResolverSource(id=1, name="s", resolver_id=1))
            await db.commit()


async def _rebuild_and_probe(tmp_path: Path, *, with_children: bool) -> dict:
    engine, maker = await _engine_with_stale_resolvers(tmp_path)
    await _seed(maker, with_children=with_children)

    await ensure_db(engine)  # the defect made this raise "FOREIGN KEY constraint failed"

    async with engine.begin() as conn:
        def _probe(sync_conn) -> dict:
            inspector_obj = inspect(sync_conn)
            columns = {c["name"]: c for c in inspector_obj.get_columns("resolvers")}
            probe = {
                "orphan": inspector_obj.has_table("_old_resolvers"),
                "not_null": columns["has_catalog"]["nullable"] is False,
                "resolvers": sync_conn.execute(text("SELECT id, has_catalog FROM resolvers")).fetchall(),
                "fk_violations": sync_conn.execute(text("PRAGMA foreign_key_check")).fetchall(),
                "profiles_resolver_fk_target": [
                    row[2]
                    for row in sync_conn.execute(text("PRAGMA foreign_key_list(profiles)")).fetchall()
                    if row[3] == "resolver_id"
                ],
            }
            if with_children:
                probe["join"] = sync_conn.execute(text(
                    "SELECT profiles.id, resolvers.id FROM profiles "
                    "JOIN resolvers ON resolvers.id = profiles.resolver_id"
                )).fetchall()
            return probe

        probe = await conn.run_sync(_probe)

    await engine.dispose()
    return probe


def test_rebuild_keeps_children_and_leaves_no_litter(tmp_path):
    probe = asyncio.run(_rebuild_and_probe(tmp_path, with_children=True))

    assert probe["not_null"], "rebuild did not apply the NOT NULL constraint"
    assert probe["resolvers"] == [(1, 1)], "resolver row lost or value changed"
    assert probe["join"] == [(1, 1)], "child FK no longer resolves to the rebuilt table"
    assert probe["profiles_resolver_fk_target"] == ["resolvers"]
    assert probe["fk_violations"] == [], "foreign key violations after rebuild"
    assert not probe["orphan"], "orphan _old_resolvers left behind"


def test_rebuild_with_no_child_rows(tmp_path):
    probe = asyncio.run(_rebuild_and_probe(tmp_path, with_children=False))

    assert probe["not_null"]
    assert probe["resolvers"] == [(1, 1)]
    assert probe["profiles_resolver_fk_target"] == ["resolvers"]
    assert probe["fk_violations"] == []
    assert not probe["orphan"]
