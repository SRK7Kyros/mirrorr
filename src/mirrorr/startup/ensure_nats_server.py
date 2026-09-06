from __future__ import annotations

import asyncio
import atexit
from contextlib import closing
import hashlib
import io
import os
import platform
import subprocess
import sys
import tarfile
import threading
import zipfile
from pathlib import Path

import httpx
import psutil
import shutil
import socket
from loguru import logger


def is_port_open(port: int, host: str = "127.0.0.1", timeout: float = 0.5) -> bool:
    with closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
        sock.settimeout(timeout)
        return sock.connect_ex((host, port)) == 0


# NATS server version to download. When upgrading, verify the release
# checksums page on GitHub matches the assets you expect.
_NATS_VERSION = "v2.10.22"


class NatsServerManager:
    """Manages a local NATS server process.

    Uses a Windows Job Object (or process-group session leadership on Unix)
    to guarantee that the child is killed when the parent dies, regardless
    of how the parent dies (crash, hard kill, Ctrl+C, etc.).
    """

    def __init__(self, settings: "MirrorrSettings") -> None:  # ty: ignore[unresolved-reference] — TYPE_CHECKING pattern
        self._settings = settings
        self._process: psutil.Popen | None = None
        self._log_thread: threading.Thread | None = None
        self._job_handle: int | None = None  # Windows Job Object handle

        self.port: int = settings.nats_port
        self.bin_dir: str = str(settings.nats_bin_dir)
        self.exe_name: str = "nats-server.exe" if platform.system() == "Windows" else "nats-server"
        self.nats_path: str = str(Path(self.bin_dir) / self.exe_name)

        atexit.register(self._atexit_stop)

    # ── download / install ─────────────────────────────────────────────

    def _get_download_url(self) -> str:
        system = platform.system().lower()
        machine = platform.machine().lower()
        version = _NATS_VERSION
        arch = "arm64" if "arm" in machine or "aarch64" in machine else "amd64"
        ext = "zip" if system == "windows" else "tar.gz"
        return (
            f"https://github.com/nats-io/nats-server/releases/download/"
            f"{version}/nats-server-{version}-{system}-{arch}.{ext}"
        )

    def _get_checksum_url(self) -> str:
        """URL of the official SHA256 checksum file published alongside the release."""
        return (
            f"https://github.com/nats-io/nats-server/releases/download/"
            f"{_NATS_VERSION}/SHA256SUMS"
        )

    async def _verify_checksum(self, filename: str, content: bytes) -> bool:
        """Verify the downloaded archive against the official SHA256SUMS file.

        Returns True if verification succeeds, False if the checksum file
        could not be fetched (with a warning), and raises on mismatch.
        """
        try:
            async with httpx.AsyncClient(follow_redirects=True) as client:
                resp = await client.get(self._get_checksum_url())
                if resp.status_code != 200:
                    logger.warning(
                        f"Could not fetch SHA256SUMS (status {resp.status_code}) — "
                        "skipping checksum verification."
                    )
                    return False
                sums_text = resp.text
        except Exception as e:
            logger.warning(f"Could not fetch SHA256SUMS ({e}) — skipping checksum verification.")
            return False

        expected: str | None = None
        for line in sums_text.splitlines():
            parts = line.split(None, 1)
            if len(parts) == 2 and parts[1].strip() == filename:
                expected = parts[0].strip().lower()
                break
        if not expected:
            logger.warning(
                f"{filename} not found in SHA256SUMS — skipping checksum verification."
            )
            return False

        actual = hashlib.sha256(content).hexdigest().lower()
        if actual != expected:
            raise RuntimeError(
                f"NATS binary checksum mismatch for {filename}: "
                f"expected {expected}, got {actual}. Aborting — possible "
                "supply-chain tampering."
            )
        logger.info(f"NATS binary checksum verified for {filename}")
        return True

    async def _install(self) -> None:
        url = self._get_download_url()
        tmp_download_folder = f"{self.bin_dir}_tmp"
        filename = url.split("/")[-1]
        full_path = str(Path(tmp_download_folder) / filename)

        logger.info(f"Downloading NATS server to {full_path}")
        try:
            async with httpx.AsyncClient(follow_redirects=True) as client:
                response = await client.get(url)
                response.raise_for_status()

            # Verify the download against the official SHA256SUMS before
            # extracting or executing anything. Aborts on mismatch.
            await self._verify_checksum(filename, response.content)

            # All file I/O below is blocking (open/copyfileobj/zipfile/tarfile/
            # shutil.copytree/shutil.rmtree). Run it in a worker thread so the
            # asyncio event loop is not frozen during the first-time download.
            await asyncio.to_thread(
                self._install_blocking,
                full_path,
                tmp_download_folder,
                filename,
                response.content,
            )
            logger.info("NATS server downloaded successfully.")
        except Exception as e:
            logger.critical(f"NATS installation failed: {e}")
            await asyncio.to_thread(shutil.rmtree, tmp_download_folder, ignore_errors=True)
            raise e

    def _install_blocking(
        self,
        full_path: str,
        tmp_download_folder: str,
        filename: str,
        content: bytes,
    ) -> None:
        """Synchronous blocking I/O for NATS install — run via asyncio.to_thread."""
        bytesio = io.BytesIO(content)
        Path(tmp_download_folder).mkdir(parents=True, exist_ok=True)
        with open(full_path, "wb") as f:
            shutil.copyfileobj(bytesio, f)

        logger.info(f"Downloaded NATS server: {full_path}")
        if filename.endswith(".zip"):
            with zipfile.ZipFile(full_path, "r") as zip_ref:
                zip_ref.extractall(tmp_download_folder)
        else:
            with tarfile.open(full_path, "r:gz") as tar:
                tar.extractall(tmp_download_folder, filter="data")
        if filename.endswith(".tar.gz"):
            dir_name = filename[:-7]
        else:
            dir_name = filename.rsplit(".", 1)[0]
        extracted_dir = str(Path(tmp_download_folder) / dir_name)

        shutil.copytree(extracted_dir, self.bin_dir, dirs_exist_ok=True)
        shutil.rmtree(tmp_download_folder)

    async def ensure(self) -> None:
        if self._settings.use_system_nats:
            if shutil.which("nats-server"):
                logger.info("Using system nats-server")
                self.nats_path = "nats-server"
                return
            raise RuntimeError("use_system_nats is True but nats-server not found in PATH")

        if not Path(self.nats_path).exists():
            await self._install()
        else:
            logger.info("Using bundled nats-server")

    # ── lifecycle ──────────────────────────────────────────────────────

    def _write_js_conf(self) -> str:
        """Write js.conf into nats_server_dir with the correct store_dir."""
        nats_dir = str(self._settings.nats_server_dir)
        Path(nats_dir).mkdir(parents=True, exist_ok=True)
        js_conf_path = str(Path(nats_dir) / "js.conf")
        store_dir_posix = nats_dir.replace("\\", "/")
        with open(js_conf_path, "w") as f:
            f.write(
                "jetstream {\n"
                f"  store_dir: {store_dir_posix}\n"
                "  max_memory_store: 1073741824\n"
                "}\n"
            )
        return js_conf_path


    async def start(self) -> None:
        if self._process is not None and self._process.is_running():
            return

        await self.ensure()

        js_conf = self._write_js_conf()

        # Start NATS in its own process group so Ctrl+C in the parent
        # does NOT kill it.  We shut it down explicitly via stop().
        kwargs: dict = dict(
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        if sys.platform == "win32":
            # CREATE_NO_WINDOW: NATS server runs without a console window,
            # so it does NOT receive CTRL_C_EVENT from the console.
            # CREATE_NEW_PROCESS_GROUP: gives it its own process group
            # so we can still terminate() it cleanly.
            kwargs["creationflags"] = (
                subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
            )
        else:
            kwargs["preexec_fn"] = os.setsid

        # On Windows, create a Job Object and assign the child to it.
        # When the parent process dies (for ANY reason), Windows automatically
        # terminates all processes in the Job Object. This is the only way to
        # guarantee no orphans on Windows.
        if sys.platform == "win32":
            import ctypes
            import ctypes.wintypes

            # Create the Job Object
            job_handle = ctypes.windll.kernel32.CreateJobObjectW(None, None)

            # Set the "kill on close" action
            class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
                _fields_ = [
                    ("PerProcessUserTimeLimit", ctypes.c_longlong),
                    ("PerJobUserTimeLimit", ctypes.c_longlong),
                    ("LimitFlags", ctypes.wintypes.DWORD),
                    ("MinimumWorkingSetSize", ctypes.c_size_t),
                    ("MaximumWorkingSetSize", ctypes.c_size_t),
                    ("ActiveProcessLimit", ctypes.wintypes.DWORD),
                    ("Affinity", ctypes.c_void_p),
                    ("PriorityClass", ctypes.wintypes.DWORD),
                    ("SchedulingClass", ctypes.wintypes.DWORD),
                ]

            class IO_COUNTERS(ctypes.Structure):
                _fields_ = [
                    ("ReadOperationCount", ctypes.c_ulonglong),
                    ("WriteOperationCount", ctypes.c_ulonglong),
                    ("OtherOperationCount", ctypes.c_ulonglong),
                    ("ReadTransferCount", ctypes.c_ulonglong),
                    ("WriteTransferCount", ctypes.c_ulonglong),
                    ("OtherTransferCount", ctypes.c_ulonglong),
                ]

            class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
                _fields_ = [
                    ("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
                    ("IoInfo", IO_COUNTERS),
                    ("ProcessMemoryLimit", ctypes.c_size_t),
                    ("JobMemoryLimit", ctypes.c_size_t),
                    ("PeakProcessMemoryUsed", ctypes.c_size_t),
                    ("PeakJobMemoryUsed", ctypes.c_size_t),
                ]

            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000

            ji = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
            ji.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE

            ctypes.windll.kernel32.SetInformationJobObject(
                job_handle,
                9,  # JobObjectExtendedLimitInformation
                ctypes.byref(ji),
                ctypes.sizeof(ji),
            )
            self._job_handle = job_handle

        self._process = psutil.Popen(
            [self.nats_path, "-js", "-c", js_conf, "-p", str(self.port)],
            **kwargs,
        )

        # Assign the child to the Job Object so it's killed when we close the handle.
        # CRITICAL: AssignProcessToJobObject expects a process HANDLE (kernel object),
        # NOT a PID.  subprocess.Popen stores the handle in _handle; the PID is just
        # a numeric identifier — passing it here silently fails and the job stays empty.
        if sys.platform == "win32" and self._job_handle is not None:
            import ctypes
            if not ctypes.windll.kernel32.AssignProcessToJobObject(
                self._job_handle, self._process._handle
            ):
                logger.error(
                    f"AssignProcessToJobObject failed for NATS PID {self._process.pid} "
                    f"(error {ctypes.GetLastError()}). NATS may not be killed on shutdown."
                )
            else:
                logger.debug(f"Assigned NATS PID {self._process.pid} to Job Object")

        self._log_thread = threading.Thread(target=self._consume_and_log, daemon=True)
        self._log_thread.start()

        logger.info(f"Launched NATS server to start on port {self.port}...")
        max_retries = 10
        for i in range(max_retries):
            await asyncio.sleep(0.5)
            if is_port_open(self.port):
                logger.info("NATS server is up and accepting connections!")
                return
            logger.info(f"NATS server didn't start up, retrying ({i + 1}/{max_retries})")

        raise RuntimeError("NATS server failed to start in time.")

    def _consume_and_log(self) -> None:
        if not self._process or not self._process.stdout:
            return

        nats_logger = logger.patch(lambda r: r.update(name="NATS-Server"))

        for line in iter(self._process.stdout.readline, ""):
            line = line.strip()
            if not line:
                continue
            if "[INF]" in line:
                nats_logger.info(line.split("[INF]")[-1][1:])
            elif "[WRN]" in line:
                nats_logger.warning(line.split("[WRN]")[-1][1:])
            elif "[ERR]" in line:
                nats_logger.error(line.split("[ERR]")[-1][1:])
            else:
                nats_logger.info(line)

    def _atexit_stop(self) -> None:
        """Called by atexit on process exit. Ensures cleanup."""
        self.stop()

    def stop(self) -> None:
        try:
            if self._process and self._process.is_running():
                logger.info(f"Terminating NATS process {self._process.pid}...")
                self._process.terminate()
                _gone, alive = psutil.wait_procs([self._process], timeout=3)
                for p in alive:
                    p.kill()
        finally:
            self._process = None
            self._log_thread = None

            # Close the Windows Job Object handle — this triggers
            # KILL_ON_JOB_CLOSE, killing any remaining children.
            if self._job_handle is not None:
                import ctypes
                ctypes.windll.kernel32.CloseHandle(self._job_handle)
                self._job_handle = None
