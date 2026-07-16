"""Entry points for the session supervisor process.

Extracted from session_supervisor.py to separate the process-spawning
entry point from the supervisor class itself.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from multiprocessing.synchronize import Event as ShutdownEvent

from loguru import logger

from src.startup.config import MirrorrSettings
from src.storage.enums import SessionStatus
from src.services.session_lifecycle import update_session


async def runner(
    session_id: int,
    settings: MirrorrSettings,
    shutdown_event: ShutdownEvent | None = None,
) -> None:
    """Async entry point: load session, create supervisor, run."""
    from src.startup.logging import setup_logging
    setup_logging()

    try:
        logger.opt(colors=True).info(
            f"Starting session supervisor for session <green>{session_id}</green>"
        )
        from src.services.session_helpers import load_session_from_db
        session, engine_interface, resolver_interface = await load_session_from_db(
            settings, session_id
        )
        from src.services.session_supervisor import SessionSupervisor
        supervisor = SessionSupervisor(
            session_id, session, engine_interface, resolver_interface, settings
        )
        logger.opt(colors=True).success(
            f"Supervisor created for session <green>{session_id}</green>"
        )

        # Monitor the cross-platform shutdown event and emit a stop into the ProcessBus
        async def _watch_shutdown():
            await asyncio.get_running_loop().run_in_executor(None, shutdown_event.wait)
            logger.info(f"Session {session_id}: shutdown event received")
            await supervisor.bus.emit("session.stop_requested")

        if shutdown_event:
            asyncio.create_task(_watch_shutdown())

        await supervisor.run()
    except ValueError as e:
        logger.error(e)
        # Session not found or missing profile — mark FAILED
        await update_session(settings, session_id, status=SessionStatus.FAILED)
        raise
    except Exception as e:
        logger.error(f"Session {session_id} failed with exception: {e}")
        await update_session(settings, session_id, status=SessionStatus.FAILED)
        raise


def main(
    session_id: int,
    settings: MirrorrSettings,
    shutdown_event: ShutdownEvent | None = None,
) -> None:
    """Blocking entry point for multiprocessing.Process."""
    # On Windows, ignore Ctrl+C in child processes — the parent controls
    # shutdown via the multiprocessing.Event. Without this, CTRL_C_EVENT
    # raises KeyboardInterrupt inside asyncio.run() and tears down the
    # event loop before cleanup can run, leaking pipe transports.
    if sys.platform == "win32" and shutdown_event is not None:
        import signal as _signal
        _signal.signal(_signal.SIGINT, _signal.SIG_IGN)

    try:
        asyncio.run(runner(session_id, settings, shutdown_event))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--session-id", type=int, required=True)
    args = parser.parse_args()
    settings = MirrorrSettings.create_from_env(".env")
    main(args.session_id, settings)
