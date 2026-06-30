from __future__ import annotations

import sys
import asyncio
import signal
import uvicorn

from loguru import logger

from src.startup.config import MirrorrSettings, _PACKAGE_ROOT


class MirrorrCore:
    """Main entry point for the Mirrorr backend server.

    Usage::

        from mirrorr.core import MirrorrCore

        # programmatic
        core = MirrorrCore(MirrorrSettings(base_dir="./my_data"))
        await core.run_async()

        # blocking
        core.run_blocking()

        # as a task
        task = core.to_task()
    """

    def __init__(self, settings: MirrorrSettings) -> None:
        self.settings = settings

        # Resolved at runtime -- set during _boot()
        self._db_engine = None
        self._session_factory = None
        self._nats_manager = None
        self._uvicorn_server: uvicorn.Server | None = None
        self._scheduler_task: asyncio.Task | None = None
        self._scheduler_stop: asyncio.Event | None = None

    def _signal_shutdown(self) -> None:
        """Called by the signal handler. Tells uvicorn to shut down."""
        if self._uvicorn_server:
            self._uvicorn_server.should_exit = True

    # ── plugin management ──────────────────────────────────────────────

    def restore_default_plugins(self) -> None:
        """Copy bundled default plugin files from ``src/default_plugins/``
        into *dest_dir*. Called only when *dest_dir* does not yet exist, or explicitly by the caller.
        """
        import shutil
        defaults_dir = _PACKAGE_ROOT / "default_plugins"
        logger.info(f"Restoring default plugins from {defaults_dir}")
        if not defaults_dir.exists():
            logger.warning(f"Default plugins directory not found at {defaults_dir}")
            return
        default_engines_dir = defaults_dir / "engines"
        default_resolvers_dir = defaults_dir / "resolvers"
        for plugin_dir, default_dir in [(self.settings.engines_dir, default_engines_dir), (self.settings.resolvers_dir, default_resolvers_dir)]:
            if not plugin_dir.exists():
                plugin_dir.mkdir(parents=True, exist_ok=True)
                for py_file in default_dir.glob("*.py"):
                    if py_file.name.startswith("_"):
                        continue
                    shutil.copy2(py_file, plugin_dir / py_file.name)
                    logger.info(f"Copied default plugin: {py_file.name} -> {plugin_dir / py_file.name}")

    def _ensure_plugin_dirs(self) -> None:
        """Create plugin dirs if missing and populate with defaults."""
        dirs_exist = [self.settings.engines_dir.exists(), self.settings.resolvers_dir.exists()]
        if not any(dirs_exist):
            logger.info("No plugin dirs found, creating and populating with defaults.")
            self.restore_default_plugins()
            return
        for plugin_dir in (self.settings.engines_dir, self.settings.resolvers_dir):
            plugin_dir.mkdir(parents=True, exist_ok=True)

    # ── boot sequence ──────────────────────────────────────────────────

    async def _boot(self) -> None:
        """Initialise every subsystem in the correct order."""
        from src.startup.logging import setup_logging
        from src.startup.ensure_db import ensure_db
        from src.startup.ensure_ffmpeg import ensure_ffmpeg
        from src.startup.ensure_engines import sync_engines_db
        from src.startup.ensure_resolvers import sync_resolvers_db
        from src.storage.database import create_db_engine
        from src.event_bus.nats import bus
        import src.event_bus.handlers  # noqa: F401  — registers handlers

        setup_logging()

        # 1. Create directories
        self._ensure_plugin_dirs()
        self.settings.ensure_directories()

        # 2. Validate that at least one engine and one resolver plugin exist
        engine_plugins = list(self.settings.engines_dir.glob("*.py"))
        engine_plugins = [p for p in engine_plugins if not p.name.startswith("_")]
        resolver_plugins = list(self.settings.resolvers_dir.glob("*.py"))
        resolver_plugins = [p for p in resolver_plugins if not p.name.startswith("_")]

        if not engine_plugins:
            raise RuntimeError(
                f"No engine plugins found in {self.settings.engines_dir}. "
                "Ensure at least one engine .py file exists."
            )
        if not resolver_plugins:
            raise RuntimeError(
                f"No resolver plugins found in {self.settings.resolvers_dir}. "
                "Ensure at least one resolver .py file exists."
            )

        # 3. Database
        self._db_engine, self._session_factory = create_db_engine(self.settings)

        # 3a. Dev reset: truncate all tables before anything else if DEV_RESET_DATABASE is set
        if self.settings.dev_reset_database:
            from src.startup.ensure_db import reset_database
            await reset_database(self._db_engine)

        await ensure_db(self._db_engine)

        # Wire the session factory into the FastAPI dependency
        from src.storage.database import set_session_factory
        set_session_factory(self._session_factory)

        # 4. FFmpeg
        ensure_ffmpeg(self.settings)

        # 5. Plugins → DB sync (this repopulates the tables after a reset)
        await sync_engines_db(self.settings.engines_dir, self._session_factory)
        await sync_resolvers_db(self.settings.resolvers_dir, self._session_factory)

        # 6. NATS server
        from src.startup.ensure_nats_server import NatsServerManager
        self._nats_manager = NatsServerManager(self.settings)
        self._nats_manager.start()

        # 7. NATS client bus
        # Store settings on the bus singleton before connecting so handlers
        # can access them when spawning child processes
        # (multiprocessing pickles them).
        bus._settings = self.settings
        await bus.connect([self.settings.nats_url])
        await bus.start_subscriptions()

        # 8. Autorun scheduler
        from src.services.autorun_scheduler import autorun_scheduler_loop
        self._scheduler_stop = asyncio.Event()
        self._scheduler_task = asyncio.create_task(
            autorun_scheduler_loop(self.settings, self._session_factory, self._scheduler_stop)
        )

        logger.success("MirrorrCore boot complete.")

        # Log resolved configuration
        logger.info("----- CONFIGURATION -----")
        for k, v in self.settings.model_dump().items():
            logger.info(f"{k}={v}")
        logger.info("------------------------")

    # ── shutdown ───────────────────────────────────────────────────────

    async def _shutdown(self) -> None:
        """Gracefully tear down every subsystem."""
        logger.info("MirrorrCore shutting down...")

        # 0. Stop the autorun scheduler
        if self._scheduler_stop:
            self._scheduler_stop.set()
        if self._scheduler_task:
            try:
                await asyncio.wait_for(self._scheduler_task, timeout=5.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._scheduler_task.cancel()

        # 0.5. Kill all running supervisor processes
        from src.event_bus.handlers.handlers import kill_all_supervisors
        kill_all_supervisors()

        # 1. Drain NATS client first — unsubscribes all callbacks cleanly
        #    before closing, avoiding noisy "connection closed" log spam.
        from src.event_bus.nats import bus
        try:
            await bus.nc.drain()
        except Exception:
            pass

        # 2. Stop NATS server process
        if self._nats_manager:
            self._nats_manager.stop()

        # 3. Dispose DB engine
        if self._db_engine:
            try:
                await asyncio.wait_for(self._db_engine.dispose(), timeout=3.0)
            except Exception:
                pass

        logger.success("MirrorrCore stopped gracefully.")

    # ── public API ─────────────────────────────────────────────────────

    async def run_async(self) -> None:
        """Boot, serve until shutdown signal, then tear down.

        This is the canonical async entry point.  Call it from an
        ``asyncio.run()`` or ``await`` it in a long-lived task.
        """
        await self._boot()

        # Install signal handlers that set uvicorn's should_exit flag.
        # When uvicorn sees this flag, it stops accepting connections,
        # shuts down gracefully, and serve() returns normally —
        # no CancelledError, no exception, just a clean exit.
        loop = asyncio.get_running_loop()
        if sys.platform != "win32":
            for sig in (signal.SIGINT, signal.SIGTERM):
                loop.add_signal_handler(sig, self._signal_shutdown)
        else:
            # On Windows, loop.add_signal_handler is not supported.
            # Use ctypes to set a console control handler that calls
            # into the event loop thread-safely.
            import ctypes
            import ctypes.wintypes

            _HandlerRoutine = ctypes.WINFUNCTYPE(
                ctypes.wintypes.BOOL, ctypes.wintypes.DWORD
            )

            @_HandlerRoutine
            def _console_handler(ctrl_type):
                # 0 = CTRL_C_EVENT, 1 = CTRL_BREAK_EVENT
                if ctrl_type in (0, 1):
                    loop.call_soon_threadsafe(self._signal_shutdown)
                    return True
                return False

            # Store on self to prevent GC of the ctypes callback
            self._win_console_handler = _console_handler
            ctypes.windll.kernel32.SetConsoleCtrlHandler(_console_handler, True)

        from src.api.api import API, mount_content
        mount_content(self.settings)
        config = uvicorn.Config(
            API,
            host=self.settings.api_host,
            port=self.settings.api_port,
            log_config=None,
        )
        self._uvicorn_server = uvicorn.Server(config)
        try:
            await self._uvicorn_server.serve()
        finally:
            await self._shutdown()

    def run_blocking(self) -> None:
        """Synchronous convenience wrapper — calls ``asyncio.run`` internally."""
        asyncio.run(self.run_async())

    def to_task(self) -> asyncio.Task[None]:
        """Create and return an ``asyncio.Task`` that runs the server.

        The caller can ``await`` the task to wait for shutdown, or let it
        run in the background.
        """
        return asyncio.create_task(self.run_async())
