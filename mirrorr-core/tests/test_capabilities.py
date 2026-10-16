"""Capability foundation: the frozen enum, the resource_access migration, and
the has_capability / require_capability predicate matrix."""

from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException
from loguru import logger
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError
from sqlmodel import SQLModel, select
from sqlmodel.ext.asyncio.session import AsyncSession as SQLModelAsyncSession

from mirrorr.api.dependencies import AuthState
from mirrorr.services.permissions import has_capability, require_capability
from mirrorr.startup.config import MirrorrSettings
from mirrorr.startup.ensure_db import ensure_db
from mirrorr.storage.database import create_db_engine
from mirrorr.storage.enums import Capability, ResourceType, UserRole
from mirrorr.storage.models import (
    Engine,
    Resolver,
    ResourceAccess,
    Session,
    User,
)

ALL_CAPABILITIES = list(Capability)

# `resource_access` as it was before capabilities: no capability column and the
# 3-column UNIQUE.
_OLD_RESOURCE_ACCESS_DDL = """
CREATE TABLE resource_access (
    id INTEGER NOT NULL,
    resource_type VARCHAR(9),
    resource_id INTEGER NOT NULL,
    username VARCHAR NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (resource_type, resource_id, username)
)
"""

# SQLModel emits one named index per `index=True` field. A `RENAME TO` keeps
# these names attached to the renamed table, so the rebuild's `CREATE TABLE`
# collides on them — the defect these tests pin.
_OLD_RESOURCE_ACCESS_INDEX_DDL = (
    "CREATE INDEX ix_resource_access_resource_type ON resource_access (resource_type)",
    "CREATE INDEX ix_resource_access_resource_id ON resource_access (resource_id)",
    "CREATE INDEX ix_resource_access_username ON resource_access (username)",
)


def _capture_logs() -> tuple[list[dict], int]:
    records: list[dict] = []
    sink_id = logger.add(lambda message: records.append(message.record), level="DEBUG")
    return records, sink_id


# ── Enum ────────────────────────────────────────────────────────────────────

def test_capability_enum_is_frozen():
    assert [c.name for c in Capability] == [
        "VIEW", "OPERATE", "EDIT", "DELETE", "SHARE", "EXPORT",
    ]


def test_unknown_capability_rejected():
    with pytest.raises(ValueError) as excinfo:
        Capability("BOGUS")
    assert "BOGUS" in str(excinfo.value)


# ── Migration ───────────────────────────────────────────────────────────────

async def _probe_resource_access(engine) -> dict:
    async with engine.connect() as conn:
        def _probe(sync_conn) -> dict:
            inspector_obj = inspect(sync_conn)
            columns = [c["name"] for c in inspector_obj.get_columns("resource_access")]
            selected = "resource_type, resource_id, username" + (
                ", capability" if "capability" in columns else ""
            )
            return {
                "columns": columns,
                "rows": sync_conn.exec_driver_sql(
                    f"SELECT {selected} FROM resource_access ORDER BY id"
                ).fetchall(),
                "unique": [
                    tuple(uc["column_names"])
                    for uc in inspector_obj.get_unique_constraints("resource_access")
                ],
                "orphan": inspector_obj.has_table("_old_resource_access"),
                "indexes": sorted(
                    row[1] for row in sync_conn.exec_driver_sql(
                        "PRAGMA index_list(resource_access)"
                    ).fetchall()
                ),
                "ddl": sync_conn.exec_driver_sql(
                    "SELECT sql FROM sqlite_master WHERE name='resource_access'"
                ).scalar(),
            }
        return await conn.run_sync(_probe)


async def _migrate_and_probe(tmp_path) -> tuple[dict, dict]:
    engine, _ = create_db_engine(MirrorrSettings(base_dir=tmp_path))
    async with engine.begin() as conn:
        await conn.exec_driver_sql(_OLD_RESOURCE_ACCESS_DDL)
        await conn.run_sync(SQLModel.metadata.create_all)
        await conn.exec_driver_sql(
            "INSERT INTO resource_access (resource_type, resource_id, username, created_at) "
            "VALUES ('SESSION', 1, 'bob', '2024-01-01 00:00:00'), "
            "('PROFILE', 2, 'carol', '2024-01-01 00:00:00')"
        )
    before = await _probe_resource_access(engine)
    await ensure_db(engine)
    after = await _probe_resource_access(engine)
    await engine.dispose()
    return before, after


def test_migration_backfills_view_and_widens_unique(tmp_path):
    before, after = asyncio.run(_migrate_and_probe(tmp_path))

    assert "capability" not in before["columns"]
    assert before["unique"] == [("resource_type", "resource_id", "username")]
    assert before["rows"] == [
        ("SESSION", 1, "bob"),
        ("PROFILE", 2, "carol"),
    ]

    # A no-op migration would leave the column absent and these rows unnamed.
    assert "capability" in after["columns"]
    assert after["rows"] == [
        ("SESSION", 1, "bob", "VIEW"),
        ("PROFILE", 2, "carol", "VIEW"),
    ]
    assert after["unique"] == [("resource_type", "resource_id", "username", "capability")]
    assert not after["orphan"]


async def _migrate_indexed_and_probe(tmp_path) -> tuple[dict, dict]:
    engine, _ = create_db_engine(MirrorrSettings(base_dir=tmp_path))
    async with engine.begin() as conn:
        await conn.exec_driver_sql(_OLD_RESOURCE_ACCESS_DDL)
        for statement in _OLD_RESOURCE_ACCESS_INDEX_DDL:
            await conn.exec_driver_sql(statement)
        await conn.run_sync(SQLModel.metadata.create_all)
        await conn.exec_driver_sql(
            "INSERT INTO resource_access (resource_type, resource_id, username, created_at) "
            "VALUES ('SESSION', 1, 'bob', '2024-01-01 00:00:00'), "
            "('PROFILE', 2, 'carol', '2024-01-01 00:00:00')"
        )
    before = await _probe_resource_access(engine)
    await ensure_db(engine)
    after = await _probe_resource_access(engine)
    await engine.dispose()
    return before, after


def test_rebuild_with_named_indexes_keeps_rows(tmp_path):
    records, sink_id = _capture_logs()
    try:
        before, after = asyncio.run(_migrate_indexed_and_probe(tmp_path))
    finally:
        logger.remove(sink_id)

    assert before["unique"] == [("resource_type", "resource_id", "username")]
    assert "ix_resource_access_username" in before["indexes"]

    # Before the fix this raised "index ix_resource_access_username already
    # exists" inside the rebuild, before the row copy — losing these rows.
    assert after["rows"] == [
        ("SESSION", 1, "bob", "VIEW"),
        ("PROFILE", 2, "carol", "VIEW"),
    ]
    assert after["unique"] == [("resource_type", "resource_id", "username", "capability")]
    assert "ix_resource_access_username" in after["indexes"]
    assert "ix_resource_access_capability" in after["indexes"]
    assert not after["orphan"], "rebuild left an _old_resource_access behind"
    assert not any("resource_access.capability" in record["message"] for record in records), \
        "ADD COLUMN ran against a table already pending rebuild"


async def _interrupted_then_sweep(tmp_path, *, live_conflict: bool) -> dict:
    # The state boot 1 left: live table at the model schema with 0 rows, and the
    # real rows stranded in an _old sibling (old shape, plus a column the live
    # table lacks).
    engine, _ = create_db_engine(MirrorrSettings(base_dir=tmp_path))
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
        await conn.exec_driver_sql("""
            CREATE TABLE _old_resource_access (
                id INTEGER NOT NULL,
                resource_type VARCHAR(9),
                resource_id INTEGER NOT NULL,
                username VARCHAR NOT NULL,
                created_at DATETIME NOT NULL,
                legacy_extra TEXT,
                PRIMARY KEY (id),
                UNIQUE (resource_type, resource_id, username)
            )
        """)
        await conn.exec_driver_sql(
            "INSERT INTO _old_resource_access "
            "(id, resource_type, resource_id, username, created_at, legacy_extra) VALUES "
            "(1, 'SESSION', 1, 'bob', '2024-01-01 00:00:00', 'x'), "
            "(2, 'PROFILE', 2, 'carol', '2024-01-01 00:00:00', 'y'), "
            "(3, 'SESSION', 3, 'dave', '2024-01-01 00:00:00', 'z')"
        )
        if live_conflict:
            await conn.exec_driver_sql(
                "INSERT INTO resource_access "
                "(resource_type, resource_id, username, capability, created_at) "
                "VALUES ('SESSION', 1, 'bob', 'VIEW', '2024-01-01 00:00:00')"
            )
    await ensure_db(engine)
    after = await _probe_resource_access(engine)
    await engine.dispose()
    return after


def test_sweep_recovers_orphan_rows_into_empty_live_table(tmp_path):
    after = asyncio.run(_interrupted_then_sweep(tmp_path, live_conflict=False))

    assert after["rows"] == [
        ("SESSION", 1, "bob", "VIEW"),
        ("PROFILE", 2, "carol", "VIEW"),
        ("SESSION", 3, "dave", "VIEW"),
    ]
    assert not after["orphan"]


def test_sweep_recovers_rows_and_ignores_live_conflicts(tmp_path):
    after = asyncio.run(_interrupted_then_sweep(tmp_path, live_conflict=True))

    # Row id 1 collides with the live row and is dropped by INSERT OR IGNORE;
    # the other two are rescued.
    assert after["rows"] == [
        ("SESSION", 1, "bob", "VIEW"),
        ("PROFILE", 2, "carol", "VIEW"),
        ("SESSION", 3, "dave", "VIEW"),
    ]
    assert not after["orphan"]


def test_migration_is_idempotent(tmp_path):
    async def _run():
        engine, _ = create_db_engine(MirrorrSettings(base_dir=tmp_path))
        async with engine.begin() as conn:
            await conn.exec_driver_sql(_OLD_RESOURCE_ACCESS_DDL)
            for statement in _OLD_RESOURCE_ACCESS_INDEX_DDL:
                await conn.exec_driver_sql(statement)
            await conn.run_sync(SQLModel.metadata.create_all)
            await conn.exec_driver_sql(
                "INSERT INTO resource_access (resource_type, resource_id, username, created_at) "
                "VALUES ('SESSION', 1, 'bob', '2024-01-01 00:00:00')"
            )
        await ensure_db(engine)
        first = await _probe_resource_access(engine)
        await ensure_db(engine)
        second = await _probe_resource_access(engine)
        await engine.dispose()
        return first, second

    records, sink_id = _capture_logs()
    try:
        first, second = asyncio.run(_run())
    finally:
        logger.remove(sink_id)

    assert first == second
    errors = [record["message"] for record in records if record["level"].no >= 40]
    assert errors == [], errors


# ── Predicate ───────────────────────────────────────────────────────────────

async def _seeded(tmp_path):
    engine, maker = create_db_engine(MirrorrSettings(base_dir=tmp_path))
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    async with maker() as db:
        db.add(Engine(id=1, name="e", origin="o", origin_hash="h"))
        db.add(Resolver(id=1, name="r", description="d", origin="o", origin_hash="h", has_catalog=True))
        db.add(Session(id=1, engine_id=1, resolver_id=1, requester_user_token="alice"))
        db.add(Session(id=2, engine_id=1, resolver_id=1, requester_user_token="alice"))
        db.add(ResourceAccess(resource_type=ResourceType.SESSION, resource_id=1, username="bob", capability=Capability.VIEW))
        db.add(ResourceAccess(resource_type=ResourceType.SESSION, resource_id=1, username="bob", capability=Capability.OPERATE))
        await db.commit()
    return engine, maker


def _auth(username: str | None, admin: bool = False) -> AuthState:
    user = None if username is None else User(id=1, username=username, role=UserRole.ADMIN if admin else UserRole.USER)
    return AuthState(client=None, user=user, is_admin=admin)


async def _matrix(tmp_path) -> dict:
    engine, maker = await _seeded(tmp_path)
    async with maker() as db:
        s1 = await db.get(Session, 1)
        s2 = await db.get(Session, 2)
        engine_row = await db.get(Engine, 1)

        async def caps(auth, obj):
            return {c: await has_capability(db, auth, obj, c) for c in ALL_CAPABILITIES}

        matrix = {
            "alice": await caps(_auth("alice"), s1),
            "admin": await caps(_auth("root", admin=True), s1),
            "bob": await caps(_auth("bob"), s1),
            "carol": await caps(_auth("carol"), s1),
            "anon": await caps(_auth(None), s1),
            "bob_other": await caps(_auth("bob"), s2),
            "bob_engine": await caps(_auth("bob"), engine_row),
            "admin_engine": await caps(_auth("root", admin=True), engine_row),
        }
    await engine.dispose()
    return matrix


def test_has_capability_matrix(tmp_path):
    matrix = asyncio.run(_matrix(tmp_path))

    assert all(matrix["alice"].values()), "owner must hold all six"
    assert all(matrix["admin"].values()), "admin must hold all six"
    assert matrix["bob"] == {
        Capability.VIEW: True,
        Capability.OPERATE: True,
        Capability.EDIT: False,
        Capability.DELETE: False,
        Capability.SHARE: False,
        Capability.EXPORT: False,
    }, "a grant must confer exactly the granted capabilities"
    assert not any(matrix["carol"].values())
    assert not any(matrix["anon"].values())
    assert not any(matrix["bob_other"].values()), "grant must be scoped to its resource id"
    assert not any(matrix["bob_engine"].values()), "system rows carry no grants"
    assert not any(matrix["admin_engine"].values())


def test_require_capability_matrix(tmp_path):
    async def _run():
        engine, maker = await _seeded(tmp_path)
        out: dict = {}
        async with maker() as db:
            s1 = await db.get(Session, 1)
            for label, auth, capability in [
                ("anon", _auth(None), Capability.VIEW),
                ("bob_view", _auth("bob"), Capability.VIEW),
                ("bob_edit", _auth("bob"), Capability.EDIT),
                ("alice_delete", _auth("alice"), Capability.DELETE),
                ("admin_delete", _auth("root", admin=True), Capability.DELETE),
            ]:
                try:
                    await require_capability(db, auth, s1, capability)
                    out[label] = None
                except HTTPException as exc:
                    out[label] = (exc.status_code, exc.detail)
        await engine.dispose()
        return out

    out = asyncio.run(_run())
    assert out["anon"] == (401, "Not authenticated")
    assert out["bob_view"] is None
    assert out["bob_edit"] == (403, "Missing capability: EDIT")
    assert out["alice_delete"] is None
    assert out["admin_delete"] is None


# ── Grant rows ──────────────────────────────────────────────────────────────

def test_grant_defaults_to_view(tmp_path):
    async def _run():
        engine, maker = await _seeded(tmp_path)
        async with maker() as db:
            db.add(ResourceAccess(resource_type=ResourceType.PROFILE, resource_id=9, username="dave"))
            await db.commit()
            row = (await db.exec(select(ResourceAccess).where(ResourceAccess.username == "dave"))).first()
            value = row.capability
        await engine.dispose()
        return value

    assert asyncio.run(_run()) == Capability.VIEW


def test_same_user_distinct_capabilities_coexist(tmp_path):
    async def _run():
        engine, maker = await _seeded(tmp_path)
        async with maker() as db:
            rows = (await db.exec(
                select(ResourceAccess.capability).where(
                    ResourceAccess.resource_type == ResourceType.SESSION,
                    ResourceAccess.resource_id == 1,
                    ResourceAccess.username == "bob",
                )
            )).all()
        await engine.dispose()
        return set(rows)

    assert set(asyncio.run(_run())) == {Capability.VIEW, Capability.OPERATE}


def test_duplicate_grant_rejected_by_four_column_unique(tmp_path):
    async def _run():
        engine, maker = await _seeded(tmp_path)
        async with maker() as db:
            db.add(ResourceAccess(
                resource_type=ResourceType.SESSION, resource_id=1,
                username="bob", capability=Capability.VIEW,
            ))
            with pytest.raises(IntegrityError):
                await db.commit()
            await db.rollback()
        await engine.dispose()

    asyncio.run(_run())
