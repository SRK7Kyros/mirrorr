from __future__ import annotations
import re

from loguru import logger
from sqlmodel import SQLModel, inspect, text
from sqlalchemy.ext.asyncio import AsyncEngine

_IDENTIFIER_RE = re.compile(r'^[a-zA-Z_][a-zA-Z0-9_]*$')


def _safe_identifier(name: str) -> str:
    """Validate and return a SQL identifier to prevent injection."""
    if not _IDENTIFIER_RE.match(name):
        raise ValueError(f"Invalid SQL identifier: {name!r}")
    return name


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


def _rebuild_table_sqlite(sync_conn, table_name: str, model_table, dialect) -> None:
    """Rebuild a SQLite table in-place to fix column constraints.

    This handles nullable changes, default changes, and type changes that
    SQLite cannot apply via ALTER TABLE.
    """
    _safe_identifier(table_name)
    temp_name = f"_old_{table_name}"

    # 0. Clean up a stale _old_* table from a previous interrupted rebuild
    if inspect(sync_conn).has_table(temp_name):
        logger.warning(
            f"Found stale {temp_name} from a previous interrupted rebuild — dropping it"
        )
        sync_conn.execute(text(f"DROP TABLE {_safe_identifier(temp_name)}"))

    # 1. Rename existing table aside
    sync_conn.execute(text(f"ALTER TABLE {_safe_identifier(table_name)} RENAME TO {_safe_identifier(temp_name)}"))

    # 2. Create the new table with correct schema
    model_table.create(sync_conn, checkfirst=False)

    # 3. Determine overlapping columns
    old_cols = {c["name"] for c in inspect(sync_conn).get_columns(temp_name)}
    new_cols = [c.name for c in model_table.columns]
    common = [c for c in new_cols if c in old_cols]
    cols_csv = ", ".join(_safe_identifier(c) for c in common)

    # 4. Copy data
    sync_conn.execute(text(
        f"INSERT INTO {_safe_identifier(table_name)} ({cols_csv}) SELECT {cols_csv} FROM {_safe_identifier(temp_name)}"
    ))

    # Validate row counts match
    old_count = sync_conn.execute(text(f"SELECT COUNT(*) FROM [{temp_name}]")).scalar()
    new_count = sync_conn.execute(text(f"SELECT COUNT(*) FROM [{table_name}]")).scalar()
    if old_count != new_count:
        logger.error(f"Row count mismatch after rebuild: old={old_count} new={new_count}")
        # Roll back by renaming old table back
        sync_conn.execute(text(f"ALTER TABLE [{temp_name}] RENAME TO [{table_name}]"))
        return

    # 5. Drop old table
    sync_conn.execute(text(f"DROP TABLE {_safe_identifier(temp_name)}"))

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

            tables_to_rebuild: list[tuple[str, object]] = []

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
                    tables_to_rebuild.append((table_name, table))

                # ── Add new columns ──────────────────────────────────
                for col_name, column in model_columns.items():
                    if col_name not in db_columns:
                        logger.warning(f"New column detected: {table_name}.{col_name}. Adding it...")
                        type_str = column.type.compile(dialect=dialect)
                        statement = f"ALTER TABLE {_safe_identifier(table_name)} ADD COLUMN {_safe_identifier(col_name)} {type_str}"
                        if not column.nullable and column.default is None:
                            # Use JSON-compatible default for JSON columns
                            if type_str.upper() == "JSON":
                                statement += " DEFAULT '{}'"
                            else:
                                statement += " DEFAULT ''"
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
            for table_name, table in tables_to_rebuild:
                _rebuild_table_sqlite(sync_conn, table_name, table, dialect)

        await conn.run_sync(sync_columns)
