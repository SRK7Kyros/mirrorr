from __future__ import annotations

from loguru import logger
from sqlmodel import SQLModel, inspect, text
from sqlalchemy.ext.asyncio import AsyncEngine


async def ensure_db(engine: AsyncEngine) -> None:
    """Initializes the database, ensuring the DB file exists and syncing the schema."""
    async with engine.begin() as conn:
        logger.info("Guaranteeing existence of DB file and syncing schema")
        await conn.run_sync(SQLModel.metadata.create_all)

        def sync_columns(sync_conn):
            inspector_obj = inspect(sync_conn)
            dialect = sync_conn.dialect

            # Log all tables and their columns
            for table_name in inspector_obj.get_table_names():
                columns = [c["name"] for c in inspector_obj.get_columns(table_name)]
                logger.debug(f"Table {table_name} columns: {columns}")

            for table_name, table in SQLModel.metadata.tables.items():
                if not inspector_obj.has_table(table_name):
                    continue

                db_columns = {c["name"]: c for c in inspector_obj.get_columns(table_name)}
                model_columns = {column.name: column for column in table.columns}

                for col_name, column in model_columns.items():
                    if col_name not in db_columns:
                        logger.warning(f"New column detected: {table_name}.{col_name}. Adding it...")
                        type_str = column.type.compile(dialect=dialect)
                        statement = f"ALTER TABLE {table_name} ADD COLUMN {col_name} {type_str}"
                        if not column.nullable and column.default is None:
                            # Use JSON-compatible default for JSON columns
                            if type_str.upper() == "JSON":
                                statement += " DEFAULT '{}'"
                            else:
                                statement += " DEFAULT ''"
                        logger.debug(f"SQL: {statement}")
                        sync_conn.execute(text(statement))
                        logger.info(f"Added column {table_name}.{col_name}")

                for db_col_name in db_columns.keys():
                    if db_col_name not in model_columns:
                        if db_col_name == "id":
                            continue

                        logger.warning(f"DB Column not found in schema: {table_name}.{db_col_name}. Removing...")
                        try:
                            statement = f"ALTER TABLE {table_name} DROP COLUMN {db_col_name}"
                            sync_conn.execute(text(statement))
                        except Exception as e:
                            logger.error(
                                f"Unable to drop column {table_name}.{db_col_name} (likely a foreign key constraint). "
                                f"SQLite requires a structural migration for this column. Error: {e}"
                            )

        await conn.run_sync(sync_columns)
