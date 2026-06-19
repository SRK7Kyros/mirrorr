from __future__ import annotations

import asyncio
import os
import shutil
import subprocess

from src.storage.models import (
    EngineInterface, Capabilities, Source, EngineContext,
)
from src.services.managed_process import ManagedProcess
from src.services.process_bus import EngineDone, EngineCrashed


class YtDlpPipedEngine(EngineInterface):
    """Pipes yt-dlp stdout directly into ffmpeg stdin to produce HLS output.

    Coordinates two subprocesses:
    - yt-dlp: downloads the stream, writes raw video to stdout
    - ffmpeg: reads from stdin, writes HLS segments + .m3u8 playlist

    If yt-dlp exits with non-zero, the session is crashed.
    If yt-dlp exits cleanly, waits for ffmpeg to flush, then signals done.
    """

    @property
    def name(self) -> str:
        return "yt_dlp_piped"

    @property
    def description(self) -> str:
        return "A wrapper around yt-dlp that pipes the raw video data to ffmpeg for hls playlist generation."

    @property
    def capabilities(self) -> Capabilities:
        return Capabilities(can_playlist=True, can_record=True)

    async def start(self, context: EngineContext, source: Source) -> list[ManagedProcess]:
        url = source.url
        headers = source.headers or {}
        header_args = []
        for k, v in headers.items():
            header_args.extend(["--add-headers", f"{k}:{v}"])

        yt_dlp_path = shutil.which("yt-dlp")
        if not yt_dlp_path:
            raise FileNotFoundError("yt-dlp not found in PATH")

        ffmpeg_executable = os.environ.get("FFMPEG_EXECUTABLE")
        if not ffmpeg_executable:
            raise FileNotFoundError("FFMPEG_EXECUTABLE not set in environment")

        yt_dlp_command = [
            yt_dlp_path, url,
            "--output", "-",
            "--live-from-start",
            *header_args,
        ]

        hls_list_size = context.hls_window // context.segment_duration

        ffmpeg_command = [
            ffmpeg_executable,
            "-hide_banner",
            "-loglevel", "info",
            "-i", "pipe:0",
            "-c", "copy",
            "-f", "hls",
            "-hls_time", str(context.segment_duration),
            "-hls_list_size", str(hls_list_size),
            "-hls_segment_type", "mpegts",
            "-hls_base_url", "segments/",
            "-hls_segment_filename", str(context.segments_folder / "stream-%12d.ts"),
            "-hls_flags", "delete_segments+append_list+program_date_time",
            str(context.session_folder / "stream.m3u8"),
        ]

        # Use subprocess.PIPE for both — we'll pipe data in Python
        ytdlp = ManagedProcess(
            name="yt-dlp",
            command=yt_dlp_command,
            bus=context.bus,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            stdin=subprocess.DEVNULL,
            capture_stdout=False,  # stdout is piped to ffmpeg, not logged
        )
        ffmpeg = ManagedProcess(
            name="ffmpeg",
            command=ffmpeg_command,
            bus=context.bus,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )

        # Wire yt-dlp stdout -> ffmpeg stdin via a Python pipe task
        async def _pipe():
            # Wait for both processes to be started
            while ytdlp._process is None or ffmpeg._process is None:
                await asyncio.sleep(0.01)

            ytdlp_proc = ytdlp._process
            ffmpeg_proc = ffmpeg._process
            assert ytdlp_proc.stdout is not None
            assert ffmpeg_proc.stdin is not None
            try:
                while True:
                    chunk = await ytdlp_proc.stdout.read(65536)
                    if not chunk:
                        break
                    ffmpeg_proc.stdin.write(chunk)
                    await ffmpeg_proc.stdin.drain()
            except (BrokenPipeError, ConnectionResetError):
                pass
            finally:
                try:
                    ffmpeg_proc.stdin.close()
                except Exception:
                    pass

        context._tasks.append(asyncio.create_task(_pipe()))

        # Engine coordination: watch for process exits
        async def _coordinate():
            ytdlp_exit_q = context.bus.subscribe("proc.yt-dlp.exit")
            ytdlp_exit = await ytdlp_exit_q.get()

            if ytdlp_exit.intentional:
                await ffmpeg.terminate()
                await context.bus.emit("engine.done", EngineDone(reason="stopped"))
                return

            if ytdlp_exit.returncode != 0:
                await ffmpeg.terminate()
                await context.bus.emit("engine.crashed", EngineCrashed(
                    reason=f"yt-dlp exited with code {ytdlp_exit.returncode}",
                    source_process="yt-dlp",
                    returncode=ytdlp_exit.returncode,
                ))
                return

            # yt-dlp done — wait for ffmpeg to flush
            ffmpeg_exit_q = context.bus.subscribe("proc.ffmpeg.exit")
            ffmpeg_exit = await ffmpeg_exit_q.get()

            if ffmpeg_exit.intentional or ffmpeg_exit.returncode == 0:
                await context.bus.emit("engine.done", EngineDone(reason="completed", returncode=ffmpeg_exit.returncode))
            else:
                await context.bus.emit("engine.crashed", EngineCrashed(
                    reason=f"ffmpeg exited with code {ffmpeg_exit.returncode}",
                    source_process="ffmpeg",
                    returncode=ffmpeg_exit.returncode,
                ))

        async def _watch_ffmpeg():
            ffmpeg_exit_q = context.bus.subscribe("proc.ffmpeg.exit")
            ffmpeg_exit = await ffmpeg_exit_q.get()
            if not ffmpeg_exit.intentional and ffmpeg_exit.returncode != 0:
                await ytdlp.terminate()
                await context.bus.emit("engine.crashed", EngineCrashed(
                    reason=f"ffmpeg exited unexpectedly with code {ffmpeg_exit.returncode}",
                    source_process="ffmpeg",
                    returncode=ffmpeg_exit.returncode,
                ))

        context._tasks.append(asyncio.create_task(_coordinate()))
        context._tasks.append(asyncio.create_task(_watch_ffmpeg()))

        ytdlp.set_log_dir(context.logs_folder)
        ffmpeg.set_log_dir(context.logs_folder)

        return [ytdlp, ffmpeg]
