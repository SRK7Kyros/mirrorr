from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from loguru import logger
from psutil import Process as PsProcess

from src.services.process_bus import ProcessBus, ProcessExit, ProcessOutput, EngineDone, EngineCrashed


class ManagedProcess:
    """Wraps an ``asyncio.subprocess.Process`` with event-driven lifecycle,
    structured log capture, and telemetry polling.

    Lifecycle events are published to the ``ProcessBus``:
    - ``proc.<name>.stdout`` → ``ProcessOutput`` (every line)
    - ``proc.<name>.stderr`` → ``ProcessOutput`` (every line)
    - ``proc.<name>.exit``   → ``ProcessExit`` (when the process exits)

    The process is **not started automatically**. Call ``start()`` after
    construction so the engine can register any subscribers first.
    """

    def __init__(
        self,
        name: str,
        command: list[str],
        bus: ProcessBus,
        *,
        stdin: Any = None,
        stdout: Any = asyncio.subprocess.PIPE,
        stderr: Any = asyncio.subprocess.PIPE,
        env: dict[str, str] | None = None,
        cwd: str | Path | None = None,
        capture_stdout: bool = True,
    ) -> None:
        self.name = name
        self.command = command
        self.bus = bus
        self._stdin = stdin
        self._stdout = stdout
        self._stderr = stderr
        self._env = env
        self._cwd = str(cwd) if cwd else None
        self._capture_stdout = capture_stdout

        self._process: asyncio.subprocess.Process | None = None
        self._started = False
        self._exited = False
        self._intentionally_stopped = False

        # Pipe FDs for engine-specific wiring (e.g., yt-dlp -> ffmpeg)
        self._pipe_write_fd: int | None = None
        self._pipe_read_fd: int | None = None

        # Log capture
        self._log_dir: Path | None = None

        # Telemetry
        self._telemetry_task: asyncio.Task | None = None
        self._telemetry_interval: float = 0.1  # 10 Hz

        # Internal tasks — tracked so close() can wait for them
        self._tasks: list[asyncio.Task] = []

    # ── process access ────────────────────────────────────────────────

    @property
    def process(self) -> asyncio.subprocess.Process | None:
        return self._process

    @property
    def pid(self) -> int | None:
        return self._process.pid if self._process else None

    @property
    def returncode(self) -> int | None:
        return self._process.returncode if self._process else None

    @property
    def running(self) -> bool:
        return self._process is not None and self._process.returncode is None

    # ── lifecycle ─────────────────────────────────────────────────────

    def set_log_dir(self, path: Path) -> None:
        """Set the directory where stdout/stderr are written to log files."""
        self._log_dir = path
        self._log_dir.mkdir(parents=True, exist_ok=True)

    def close_pipes(self) -> None:
        """No-op — kept for compatibility. Pipes are now managed by asyncio."""
        pass

    async def start(self) -> None:
        """Spawn the subprocess and begin capturing output + telemetry."""
        if self._started:
            raise RuntimeError(f"ManagedProcess '{self.name}' already started")

        kwargs: dict[str, Any] = {}
        if sys.platform == "win32":
            import subprocess
            kwargs["creationflags"] = (
                subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
            )

        self._process = await asyncio.create_subprocess_exec(
            *self.command,
            stdin=self._stdin,
            stdout=self._stdout,
            stderr=self._stderr,
            env=self._env,
            cwd=self._cwd,
            **kwargs,
        )
        self._started = True

        # Spawn readers
        if self._process.stdout and self._capture_stdout:
            self._tasks.append(asyncio.create_task(self._read_stream(self._process.stdout, "stdout")))
        if self._process.stderr:
            self._tasks.append(asyncio.create_task(self._read_stream(self._process.stderr, "stderr")))

        # Spawn telemetry poller
        self._telemetry_task = asyncio.create_task(self._telemetry_loop())
        self._tasks.append(self._telemetry_task)

        # Spawn exit watcher
        self._tasks.append(asyncio.create_task(self._wait_for_exit()))

        logger.opt(colors=True).info(f"[<cyan>{self.name}</cyan>] Started (pid={self._process.pid})")

    async def terminate(self) -> None:
        """Ask the process to stop gracefully."""
        if self._process and self._process.returncode is None:
            self._intentionally_stopped = True
            self._process.terminate()

    async def kill(self) -> None:
        """Force-kill the process."""
        if self._process and self._process.returncode is None:
            self._intentionally_stopped = True
            self._process.kill()

    async def close(self) -> None:
        """Wait for internal tasks to finish and close subprocess pipe handles."""
        if self._tasks:
            try:
                await asyncio.wait_for(
                    asyncio.gather(*self._tasks, return_exceptions=True),
                    timeout=5.0,
                )
            except (asyncio.TimeoutError, asyncio.CancelledError):
                for t in self._tasks:
                    if not t.done():
                        t.cancel()
            self._tasks.clear()
        # Explicitly close the subprocess transport to prevent
        # _ProactorBasePipeTransport.__del__ ResourceWarning on Windows.
        if self._process:
            transport = getattr(self._process, '_transport', None)
            if transport is not None:
                try:
                    transport.close()
                except Exception:
                    pass

    # ── internal ──────────────────────────────────────────────────────

    async def _read_stream(self, stream: asyncio.StreamReader, stream_name: str) -> None:
        """Read lines from a subprocess stream and publish to the bus.

        Handles both \n-delimited output (normal logs) and \r-delimited
        output (yt-dlp progress bars that overwrite the same line).
        """
        log_file = None
        if self._log_dir:
            log_path = self._log_dir / f"{self.name}.{stream_name}.log"
            log_file = open(log_path, "a", encoding="utf-8")

        try:
            buf = bytearray()
            while True:
                byte = await stream.read(1)
                if not byte:
                    # EOF — flush remaining buffer
                    if buf:
                        line = buf.decode("utf-8", errors="replace").rstrip("\n\r")
                        if line:
                            await self._emit_line(line, log_file, stream_name)
                    break

                if byte in (b"\n", b"\r"):
                    line = buf.decode("utf-8", errors="replace").rstrip("\n\r")
                    buf.clear()
                    if line:
                        await self._emit_line(line, log_file, stream_name)
                else:
                    buf.extend(byte)
        finally:
            if log_file:
                log_file.close()

    async def _emit_line(self, line: str, log_file, stream_name: str) -> None:
        if log_file:
            log_file.write(f"{datetime.now(timezone.utc).isoformat()} | {line}\n")
            log_file.flush()
        await self.bus.emit(
            f"proc.{self.name}.{stream_name}",
            ProcessOutput(line=line, name=self.name, stream=stream_name),
        )

    async def _wait_for_exit(self) -> None:
        """Wait for the process to exit and publish the exit event."""
        if not self._process:
            return

        returncode = await self._process.wait()
        self._exited = True

        # Close raw FDs that were passed as pipes (not asyncio-managed)
        for attr in ('_stdin', '_stdout'):
            fd = getattr(self, attr, None)
            if isinstance(fd, int):
                try:
                    os.close(fd)
                except OSError:
                    pass

        # Cancel telemetry
        if self._telemetry_task:
            self._telemetry_task.cancel()

        exit_event = ProcessExit(returncode=returncode, name=self.name, intentional=self._intentionally_stopped)
        await self.bus.emit(f"proc.{self.name}.exit", exit_event)

        if self._intentionally_stopped:
            logger.opt(colors=True).info(f"[<cyan>{self.name}</cyan>] Exited (code {returncode}, stopped intentionally)")
        elif returncode == 0:
            logger.opt(colors=True).info(f"[<cyan>{self.name}</cyan>] Exited cleanly (code 0)")
        else:
            logger.opt(colors=True).warning(f"[<cyan>{self.name}</cyan>] Exited with code {returncode}")

    async def _telemetry_loop(self) -> None:
        """Poll process resource usage at high frequency and publish samples."""
        if not self._process or not self._process.pid:
            return

        try:
            ps_proc = PsProcess(self._process.pid)
        except Exception:
            return

        try:
            while self._process.returncode is None:
                try:
                    cpu = ps_proc.cpu_percent(interval=None)
                    mem = ps_proc.memory_info()
                    await self.bus.emit(f"proc.{self.name}.telemetry", {
                        "cpu_percent": cpu,
                        "rss_bytes": mem.rss,
                        "vms_bytes": mem.vms,
                    })
                except Exception:
                    pass
                await asyncio.sleep(self._telemetry_interval)
        except asyncio.CancelledError:
            pass
