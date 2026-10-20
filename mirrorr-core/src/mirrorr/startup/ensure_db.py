from __future__ import annotations
import re
from datetime import datetime, timezone

from loguru import logger
from sqlmodel import SQLModel, inspect, text
from sqlalchemy import UniqueConstraint
from sqlalchemy.ext.asyncio import AsyncEngine

from mirrorr.storage.models import EVERYONE_GROUP_NAME, Group

_IDENTIFIER_RE = re.compile(r'^[a-zA-Z_][a-zA-Z0-9_]*$')


def _unique_column_sets(table) -> set[tuple[str, ...]]:
    """Column tuples of every UNIQUE constraint the model table declares."""
    return {
        tuple(sorted(column.name for column in constraint.columns))
        for constraint in table.constraints
        if isinstance(constraint, UniqueConstraint)
    }


def _safe_identifier(name: str) -> str:
    """Validate and return a SQL identifier to prevent injection."""
    if not _IDENTIFIER_RE.match(name):
        raise ValueError(f"Invalid SQL identifier: {name!r}")
    return name


def _sql_default(column, type_str: str) -> str:
    """Render a type-correct literal for a new NOT NULL column.

    SQLite refuses ``ADD COLUMN … NOT NULL`` without a default, and a blanket
    ``DEFAULT ''`` makes existing boolean/integer rows unreadable.
    """
    value = getattr(getattr(column, "default", None), "arg", None)
    if callable(value):
        value = None
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        return "'" + value.replace("'", "''") + "'"
    upper = type_str.upper()
    if upper == "JSON":
        return "'{}'"
    if upper in ("INTEGER", "BOOLEAN", "REAL", "NUMERIC", "FLOAT"):
        return "0"
    return "''"


async def reset_database(engine: AsyncEngine) -> None:
    """Delete all rows from all tables. Called when DEV_RESET_DATABASE is set."""
    async with engine.begin() as conn:
        def _truncate(sync_conn):
            inspector_obj = inspect(sync_conn)
            # Disable FK checks so we can truncate in any order
            sync_conn.execute(text("PRAGMA foreign_keys = OFF"))
            for table_name in inspector_obj.get_table_names():
                logger.warning(f"DEV_RESET_DATABASE: truncating table {table_name}")
                sync_conn.execute(text(f"DELETE FROM {_safe_identifier(table_name)}"))
            sync_conn.execute(text("PRAGMA foreign_keys = ON"))
        await conn.run_sync(_truncate)
    logger.warning("DEV_RESET_DATABASE: all tables truncated")


def _drop_named_indexes(sync_conn, table_name: str) -> None:
    """Drop every explicitly-created index on ``table_name``.

    A SQLite ``RENAME TO`` moves a table's named indexes along with it, keeping
    their names; the follow-up ``CREATE TABLE`` then collides on those names
    (``index ix_… already exists``) before a single row is copied. The
    constraint-backed ``sqlite_autoindex_*`` indexes cannot be dropped and are
    left alone.
    """
    rows = sync_conn.execute(
        text(f"PRAGMA index_list({_safe_identifier(table_name)})")
    ).fetchall()
    for row in rows:
        index_name = row[1]
        if index_name.startswith("sqlite_autoindex"):
            continue
        sync_conn.execute(text(f"DROP INDEX {_safe_identifier(index_name)}"))


def _rescue_then_drop_orphan(sync_conn, table_name: str, orphan_name: str) -> None:
    """Move rows from an abandoned ``_old_<table>`` sibling into the live table, then drop it.

    An interrupted rebuild leaves the real rows in the sibling while the live
    table holds none (the rebuild died before its data copy, and the restart's
    matching schema then skips the rebuild). Dropping the sibling blindly would
    silently truncate the table. Only the columns common to both are copied,
    with ``INSERT OR IGNORE`` so rows the live table already holds (by its
    PK/UNIQUE) are not duplicated.
    """
    _safe_identifier(table_name)
    _safe_identifier(orphan_name)
    inspector_obj = inspect(sync_conn)
    common = sorted(
        {c["name"] for c in inspector_obj.get_columns(table_name)}
        & {c["name"] for c in inspector_obj.get_columns(orphan_name)}
    )
    live_count = sync_conn.execute(text(f"SELECT COUNT(*) FROM {_safe_identifier(table_name)}")).scalar()
    orphan_count = sync_conn.execute(text(f"SELECT COUNT(*) FROM {_safe_identifier(orphan_name)}")).scalar()

    logger.warning(
        f"Found stale {orphan_name} ({orphan_count} row(s)) from a previous "
        f"interrupted rebuild — rescuing rows before dropping it"
    )
    if orphan_count and common and (live_count == 0 or live_count < orphan_count):
        cols_csv = ", ".join(_safe_identifier(c) for c in common)
        sync_conn.execute(text(
            f"INSERT OR IGNORE INTO {_safe_identifier(table_name)} ({cols_csv}) "
            f"SELECT {cols_csv} FROM {_safe_identifier(orphan_name)}"
        ))
        recovered = sync_conn.execute(
            text(f"SELECT COUNT(*) FROM {_safe_identifier(table_name)}")
        ).scalar() - live_count
        logger.warning(f"Recovered {recovered} row(s) from {orphan_name} into {table_name}")
    sync_conn.execute(text(f"DROP TABLE {_safe_identifier(orphan_name)}"))


def _rebuild_table_sqlite(sync_conn, table_name: str, model_table, dialect) -> None:
    """Rebuild a SQLite table in-place to fix column constraints.

    This handles nullable changes, default changes, and type changes that
    SQLite cannot apply via ALTER TABLE.
    """
    _safe_identifier(table_name)
    temp_name = f"_old_{table_name}"

    # 0. Recover a stale _old_* table from a previous interrupted rebuild
    if inspect(sync_conn).has_table(temp_name):
        _rescue_then_drop_orphan(sync_conn, table_name, temp_name)

    # RENAME on SQLite >= 3.25 rewrites each child table's REFERENCES clause to
    # follow it, so the final DROP would trip the FK check. Both pragmas are
    # needed: foreign_keys=OFF lifts that check (honoured because DDL autocommits,
    # so no transaction is open) and legacy_alter_table=ON stops the rewrite —
    # the children must keep naming the real table the new one now occupies.
    legacy = sync_conn.execute(text("PRAGMA legacy_alter_table")).scalar()
    foreign_keys = sync_conn.execute(text("PRAGMA foreign_keys")).scalar()
    sync_conn.execute(text("PRAGMA foreign_keys = OFF"))
    sync_conn.execute(text("PRAGMA legacy_alter_table = ON"))
    try:
        # 1. Rename existing table aside
        sync_conn.execute(text(f"ALTER TABLE {_safe_identifier(table_name)} RENAME TO {_safe_identifier(temp_name)}"))

        # 1a. The RENAME carried the table's named indexes with it, still under
        # their original names; free them or step 2 collides on "index ix_…
        # already exists" — before step 4 ever copies a row.
        _drop_named_indexes(sync_conn, temp_name)

        # 2. Create the new table with correct schema
        model_table.create(sync_conn, checkfirst=False)

        # 3. Determine overlapping columns
        old_cols = {c["name"] for c in inspect(sync_conn).get_columns(temp_name)}
        new_cols = [c.name for c in model_table.columns]
        common = [c for c in new_cols if c in old_cols]
        cols_csv = ", ".join(_safe_identifier(c) for c in common)

        # 4. Copy data
        if common:
            sync_conn.execute(text(
                f"INSERT INTO {_safe_identifier(table_name)} ({cols_csv}) SELECT {cols_csv} FROM {_safe_identifier(temp_name)}"
            ))

        # Validate row counts match
        old_count = sync_conn.execute(text(f"SELECT COUNT(*) FROM [{temp_name}]")).scalar()
        new_count = sync_conn.execute(text(f"SELECT COUNT(*) FROM [{table_name}]")).scalar()
        if old_count != new_count:
            logger.error(f"Row count mismatch after rebuild: old={old_count} new={new_count}")
            sync_conn.execute(text(f"DROP TABLE {_safe_identifier(table_name)}"))
            sync_conn.execute(text(f"ALTER TABLE {_safe_identifier(temp_name)} RENAME TO {_safe_identifier(table_name)}"))
            return

        # 5. Drop old table
        sync_conn.execute(text(f"DROP TABLE {_safe_identifier(temp_name)}"))
    finally:
        sync_conn.execute(text(f"PRAGMA legacy_alter_table = {'ON' if legacy else 'OFF'}"))
        sync_conn.execute(text(f"PRAGMA foreign_keys = {'ON' if foreign_keys else 'OFF'}"))

    logger.info(f"Rebuilt table {table_name} with updated column constraints")


async def ensure_db(engine: AsyncEngine) -> None:
    """Initializes the database, ensuring the DB file exists and syncing the schema."""
    async with engine.begin() as conn:
        logger.info("Guaranteeing existence of DB file and syncing schema")
        await conn.run_sync(SQLModel.metadata.create_all)

        def sync_columns(sync_conn):
            inspector_obj = inspect(sync_conn)
            dialect = sync_conn.dialect

            longest_column_length = max(len(f"Table {table_name}") for table_name in inspector_obj.get_table_names()) + 1
            # Log all tables and their columns
            for table_name in inspector_obj.get_table_names():
                columns = [c["name"] for c in inspector_obj.get_columns(table_name)]
                logger.debug(f"{f'Table {table_name}'.ljust(longest_column_length)} columns: {columns}")

            tables_to_rebuild: dict[str, object] = {}

            for table_name, table in SQLModel.metadata.tables.items():
                if not inspector_obj.has_table(table_name):
                    continue

                db_columns = {c["name"]: c for c in inspector_obj.get_columns(table_name)}
                model_columns = {column.name: column for column in table.columns}

                # ── Check for nullable constraint mismatches ──────────
                nullable_mismatches = []
                for col_name, column in model_columns.items():
                    if col_name not in db_columns:
                        continue  # handled below
                    db_nullable = db_columns[col_name].get("nullable", True)
                    model_nullable = column.nullable
                    if model_nullable is not None and db_nullable != model_nullable:
                        nullable_mismatches.append(col_name)

                if nullable_mismatches:
                    logger.warning(
                        f"Nullable constraint mismatch detected on {table_name} "
                        f"for columns: {nullable_mismatches}. "
                        f"Table will be rebuilt with correct constraints."
                    )
                    tables_to_rebuild[table_name] = table

                # ── Check for UNIQUE-constraint mismatches ────────────
                # e.g. a grant's uniqueness gained a column: SQLite cannot
                # ALTER a constraint, so the table is rebuilt below.
                db_unique = {
                    tuple(sorted(uc["column_names"]))
                    for uc in inspector_obj.get_unique_constraints(table_name)
                }
                model_unique = _unique_column_sets(table)
                if db_unique != model_unique:
                    logger.warning(
                        f"UNIQUE constraint mismatch on {table_name}: "
                        f"db={sorted(db_unique)} model={sorted(model_unique)}. "
                        f"Table will be rebuilt."
                    )
                    tables_to_rebuild[table_name] = table

                # ── Add new columns ──────────────────────────────────
                # Skipped for a table already queued for rebuild: the rebuild
                # recreates the full model schema and copies the overlapping
                # columns, so an ADD COLUMN here is noise — and it leaves the
                # interrupted state carrying a column the rebuild re-creates.
                if table_name not in tables_to_rebuild:
                    for col_name, column in model_columns.items():
                        if col_name not in db_columns:
                            logger.warning(f"New column detected: {table_name}.{col_name}. Adding it...")
                            type_str = column.type.compile(dialect=dialect)
                            statement = f"ALTER TABLE {_safe_identifier(table_name)} ADD COLUMN {_safe_identifier(col_name)} {type_str}"
                            if not column.nullable:
                                statement += f" DEFAULT {_sql_default(column, type_str)}"
                            logger.debug(f"SQL: {statement}")
                            sync_conn.execute(text(statement))
                            logger.info(f"Added column {table_name}.{col_name}")

                # ── Drop removed columns ──────────────────────────────
                for db_col_name in db_columns.keys():
                    if db_col_name not in model_columns:
                        if db_col_name == "id":
                            continue

                        logger.warning(f"DB Column not found in schema: {table_name}.{db_col_name}. Removing...")
                        try:
                            statement = f"ALTER TABLE {_safe_identifier(table_name)} DROP COLUMN {_safe_identifier(db_col_name)}"
                            sync_conn.execute(text(statement))
                        except Exception as e:
                            logger.error(
                                f"Unable to drop column {table_name}.{db_col_name} (likely a foreign key constraint). "
                                f"SQLite requires a structural migration for this column. Error: {e}"
                            )

            # ── Rebuild tables with constraint mismatches ────────────
            # We rebuild AFTER add/drop so the schema is as close to
            # the model as possible before the rebuild.
            for table_name, table in tables_to_rebuild.items():
                _rebuild_table_sqlite(sync_conn, table_name, table, dialect)

            # ── Heal abandoned _old_* siblings ──────────────────────
            # A table whose schema already matches (the rebuild above is
            # skipped) can still have an _old_ sibling left by an interrupted
            # rebuild; rescue its rows rather than leaving them stranded.
            for table_name in SQLModel.metadata.tables:
                orphan_name = f"_old_{table_name}"
                if inspect(sync_conn).has_table(orphan_name):
                    _rescue_then_drop_orphan(sync_conn, table_name, orphan_name)

            # ── Backfill the capability column added to resource_access ──
            # A column default only reaches ORM inserts, so pre-existing
            # grants read NULL until mapped to VIEW — the one capability a
            # grant used to mean.
            sync_conn.execute(text(
                "UPDATE resource_access SET capability = 'VIEW' "
                "WHERE capability IS NULL OR capability = ''"
            ))

            # ── Backfill VIEW beside every non-VIEW grant ────────────────
            # VIEW is the base capability: any grant implies it. Rows written
            # before that rule (or by a client that only named the action) gain
            # the missing VIEW row here. Runs after the _old_* sweep above so a
            # rescued row is covered too, and is idempotent via NOT EXISTS.
            sync_conn.execute(text(
                "INSERT INTO resource_access "
                "(resource_type, resource_id, username, capability, created_at) "
                "SELECT ra.resource_type, ra.resource_id, ra.username, 'VIEW', ra.created_at "
                "FROM resource_access ra "
                "WHERE ra.capability <> 'VIEW' AND NOT EXISTS ("
                "    SELECT 1 FROM resource_access v "
                "    WHERE v.resource_type = ra.resource_type "
                "      AND v.resource_id = ra.resource_id "
                "      AND v.username IS ra.username "  # NULL-safe: a grant's
                "      AND v.group_id IS ra.group_id "  # principal may be a group
                "      AND v.capability = 'VIEW'"
                ")"
            ))

            # ── Seed the reserved `everyone` group ───────────────────────
            # Membership is never materialised (permissions.group_holds
            # resolves it), so this row is all the schema needs.
            sync_conn.execute(
                Group.__table__.insert().prefix_with("OR IGNORE"),
                [{
                    "name": EVERYONE_GROUP_NAME,
                    "display_name": "Everyone",
                    "system": True,
                    "created_at": datetime.now(timezone.utc),
                }],
            )

        await conn.run_sync(sync_columns)

    # A rebuild pins `foreign_keys=OFF` on its pooled connection and SQLite
    # ignores the restore while the copy's transaction is still open, so the
    # pool is recycled to re-run the connect-time pragmas.
    await engine.dispose()
