from __future__ import annotations

from loguru import logger
from pathlib import Path
import sys
import shutil
import os


def ensure_ffmpeg(settings: "MirrorrSettings") -> None:
    """Locate or set up ffmpeg and write its path to os.environ['FFMPEG_EXECUTABLE']."""
    ffprobe_name = "ffprobe.exe" if os.name == "nt" else "ffprobe"

    if settings.use_system_ffmpeg:
        if shutil.which("ffmpeg"):
            os.environ["FFMPEG_EXECUTABLE"] = "ffmpeg"
            os.environ["FFPROBE_EXECUTABLE"] = "ffprobe"
            logger.info("Using system ffmpeg")
        else:
            raise RuntimeError("use_system_ffmpeg is True but ffmpeg is not found in system path")
    else:
        ffmpeg_dir = settings.ffmpeg_bin_dir
        exe_name = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
        bundled = ffmpeg_dir / exe_name

        if bundled.exists():
            os.environ["FFMPEG_EXECUTABLE"] = str(bundled)
            os.environ["FFPROBE_EXECUTABLE"] = str(ffmpeg_dir / ffprobe_name)
            logger.info("Using bundled ffmpeg")
        else:
            try:
                from local_ffmpeg import is_installed, install
                custom_path = str(settings.binaries_dir / "ffmpeg")
                if not is_installed(path=custom_path):
                    logger.info("Downloading FFmpeg to local folder...")
                    success, message = install(path=custom_path)
                    if success:
                        installed_exe = Path(custom_path) / exe_name
                        os.environ["FFMPEG_EXECUTABLE"] = str(installed_exe)
                        os.environ["FFPROBE_EXECUTABLE"] = str(Path(custom_path) / ffprobe_name)
                        logger.info("Using bundled ffmpeg")
                    else:
                        logger.error(f"Installation failed: {message}")
                else:
                    installed_exe = Path(custom_path) / exe_name
                    os.environ["FFMPEG_EXECUTABLE"] = str(installed_exe)
                    os.environ["FFPROBE_EXECUTABLE"] = str(Path(custom_path) / ffprobe_name)
                    logger.info("Using bundled ffmpeg")
            except ImportError:
                logger.critical(
                    "local-ffmpeg package not installed and no bundled ffmpeg found. "
                    "Install it with: pip install local-ffmpeg, or set use_system_ffmpeg=True."
                )
                raise RuntimeError(
                    "local-ffmpeg package not installed and no bundled ffmpeg found. "
                    "Install it with: pip install local-ffmpeg, or set use_system_ffmpeg=True."
                )
