from __future__ import annotations

from loguru import logger
import uvicorn

from mirrorr.api.api import API


async def run_api_server(host: str, port: int) -> None:
    """Start the FastAPI server with uvicorn."""
    logger.info(f"Starting API server on {host}:{port}...")
    config = uvicorn.Config(API, host=host, port=port, log_config=None)
    server = uvicorn.Server(config)
    await server.serve()
