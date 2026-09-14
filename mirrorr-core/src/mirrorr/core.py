from __future__ import annotations

from mirrorr.startup.logging import setup_logging
setup_logging()

import sys
import asyncio
import signal
import uvicorn

from loguru import logger

from mirrorr.startup.config import MirrorrSettings, _PACKAGE_ROOT


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
        for plugin_dir, default_dir in [
            (self.settings.engines_dir, default_engines_dir),
            (self.settings.resolvers_dir, default_resolvers_dir),
        ]:
            if not plugin_dir.exists():
                plugin_dir.mkdir(parents=True, exist_ok=True)
                for py_file in default_dir.glob("*.py"):
                    if py_file.name.startswith("_"):
                        continue
                    shutil.copy2(py_file, plugin_dir / py_file.name)
                    logger.info(
                        f"Copied default plugin: {py_file.name} -> {plugin_dir / py_file.name}"
                    )

    async def _ensure_plugin_dirs(self) -> None:
        """Create plugin dirs if missing and populate with defaults.

        The ``shutil.copy2`` calls are blocking file I/O; run them in a
        worker thread so the asyncio event loop is not frozen during the
        one-time first-boot copy.
        """
        for plugin_dir, default_dir in [
            (self.settings.engines_dir, _PACKAGE_ROOT / "default_plugins" / "engines"),
            (
                self.settings.resolvers_dir,
                _PACKAGE_ROOT / "default_plugins" / "resolvers",
            ),
        ]:
            if not plugin_dir.exists():
                plugin_dir.mkdir(parents=True, exist_ok=True)
                if default_dir.exists():
                    await asyncio.to_thread(self._copy_default_plugins, default_dir, plugin_dir)

    @staticmethod
    def _copy_default_plugins(default_dir, plugin_dir) -> None:
        """Blocking helper — copy default plugin .py files. Run via to_thread."""
        import shutil

        for py_file in default_dir.glob("*.py"):
            if py_file.name.startswith("_"):
                continue
            shutil.copy2(py_file, plugin_dir / py_file.name)
            logger.info(
                f"Copied default plugin: {py_file.name} -> {plugin_dir / py_file.name}"
            )

    # ── boot sequence ──────────────────────────────────────────────────

    async def _boot(self) -> None:
        """Initialise every subsystem in the correct order."""
        from mirrorr.startup.ensure_db import ensure_db
        from mirrorr.startup.ensure_ffmpeg import ensure_ffmpeg
        from mirrorr.startup.ensure_engines import sync_engines_db
        from mirrorr.startup.ensure_resolvers import sync_resolvers_db
        from mirrorr.storage.database import create_db_engine
        from mirrorr.event_bus.nats import bus
        import mirrorr.event_bus.handlers  # noqa: F401  — registers handlers

        logger.info("MirrorrCore booting...")

        # 1. Create directories
        await self._ensure_plugin_dirs()
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
            from mirrorr.startup.ensure_db import reset_database

            await reset_database(self._db_engine)

        await ensure_db(self._db_engine)

        # Wire the session factory into the FastAPI dependency
        from mirrorr.storage.database import set_session_factory

        set_session_factory(self._session_factory)

        # 4. FFmpeg
        ensure_ffmpeg(self.settings)

        # 5. Plugins → DB sync (this repopulates the tables after a reset)
        await sync_engines_db(self.settings.engines_dir, self._session_factory)
        await sync_resolvers_db(self.settings.resolvers_dir, self._session_factory)

        # 5a. Dev seed: auto-create admin user if DEV_SEED_ADMIN is set
        if self.settings.dev_seed_admin:
            await self._seed_admin()

        # 6. NATS server
        from mirrorr.startup.ensure_nats_server import NatsServerManager

        self._nats_manager = NatsServerManager(self.settings)
        await self._nats_manager.start()

        # 7. CORS — wire configured origins into the API
        from mirrorr.api.api import (
            API as _api_app,
            setup_cors,
            setup_http_debug_logging,
            setup_security_middleware,
        )

        if self.settings.cors_allowed_origins:
            setup_cors(_api_app, self.settings.cors_allowed_origins)
            logger.info(
                f"CORS configured with origins: {self.settings.cors_allowed_origins}"
            )
        else:
            # No origins configured — use localhost defaults for development
            setup_cors(_api_app)
            logger.warning(
                "CORS_ALLOWED_ORIGINS is empty -- using default localhost origins. "
                "Set CORS_ALLOWED_ORIGINS in your .env for production use."
            )

        # 7b. Security headers + request body size limit
        setup_security_middleware(_api_app)
        logger.info("Security headers and request body size limit middleware installed")

        # 7c. Optional HTTP request/response debug logging
        if self.settings.log_http_requests:
            setup_http_debug_logging(_api_app)
            logger.info("HTTP request/response debug logging enabled")

        # 7a. Wire settings into auth router
        from mirrorr.api.routers import auth as _auth_module

        _auth_module._rate_limit_login = self.settings.rate_limit_login
        _auth_module._rate_limit_register = self.settings.rate_limit_register
        _auth_module._cookie_secure = self.settings.cookie_secure
        _auth_module._cookie_domain = self.settings.cookie_domain

        # 8. NATS client bus
        await bus.connect([self.settings.nats_url])
        await bus.start_subscriptions()

        # 7a. Wire the DI container
        from mirrorr.di import container

        container.configure(
            settings=self.settings,
            session_factory=self._session_factory,
            event_bus=bus,
        )

        # 8. Autorun scheduler
        from mirrorr.services.autorun_scheduler import autorun_scheduler_loop

        self._scheduler_stop = asyncio.Event()
        self._scheduler_task = asyncio.create_task(
            autorun_scheduler_loop(
                self.settings, self._session_factory, self._scheduler_stop
            )
        )

        logger.success("MirrorrCore boot complete.")

        # Log resolved configuration
        _sensitive_keys = {"jwt_secret_key"}
        logger.info("----- CONFIGURATION -----")

        dirs_or_files_settings = [(key, value) for key, value in self.settings.model_dump().items() if (key.endswith("_dir") or key.endswith("_file"))]
        longest_key_length = max(len(key) for key, _ in dirs_or_files_settings) if dirs_or_files_settings else 0
        for k, v in self.settings.model_dump().items():
            if k.endswith("_dir") or k.endswith("_file"):
                logger.info(f"{k.ljust(longest_key_length)} = {v}")
            elif k in _sensitive_keys:
                logger.info(f"{k}=***")
            else:
                logger.info(f"{k}={v}")
        logger.info("------------------------")

    # ── dev helpers ────────────────────────────────────────────────────

    async def _seed_admin(self) -> None:
        """Create an admin user (admin/admin123) if it doesn't already exist.

        Only runs when ``DEV_SEED_ADMIN=True``. Safe to call repeatedly —
        skips if the user already exists.
        """
        from loguru import logger
        from sqlmodel import select
        from mirrorr.api.auth import hash_password_async
        from mirrorr.storage.models import User
        from mirrorr.storage.enums import UserRole

        if not self._session_factory:
            logger.warning("DEV_SEED_ADMIN: session factory not ready, skipping.")
            return

        async with self._session_factory() as session:
            stmt = select(User).where(User.username == "admin")
            result = await session.exec(stmt)
            if result.first() is not None:
                logger.info("DEV_SEED_ADMIN: user 'admin' already exists, skipping.")
                return

            user = User(
                username="admin",
                password_hash=await hash_password_async("admin123"),
                role=UserRole.ADMIN,
                display_name="Admin",
            )
            session.add(user)
            await session.commit()
            logger.success("DEV_SEED_ADMIN: created admin user (admin/admin123).")

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
        from mirrorr.event_bus.handlers.handlers import kill_all_supervisors

        await kill_all_supervisors()

        # 1. Drain NATS client first — unsubscribes all callbacks cleanly
        #    before closing, avoiding noisy "connection closed" log spam.
        from mirrorr.event_bus.nats import bus

        try:
            await bus.nc.drain()
        except Exception:
            pass

        # 1a. Drain the dedicated control NATS connection
        try:
            from mirrorr.event_bus.nats import drain_control_nc

            await drain_control_nc()
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

        # 4. Reset DI container
        from mirrorr.di import container

        container.reset()

        logger.info("MirrorrCore shutdown complete.")

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

        from mirrorr.api.api import API, mount_content

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
