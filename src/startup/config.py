from __future__ import annotations

from pathlib import Path
from typing import Any, Self

from pydantic import BaseModel, model_validator, computed_field


# ---------------------------------------------------------------------------
# Package-level constant: where the package source tree lives.
# Used ONLY for locating default_plugins at copy time, never at runtime.
# ---------------------------------------------------------------------------
_PACKAGE_ROOT = Path(__file__).resolve().parent.parent  # src/


class MirrorrSettings(BaseModel):
    """Configuration for a MirrorrCore instance.

    All paths are resolved to absolute at construction time so that every
    subsystem can use them directly, regardless of the process working dir.

    # Attributes:
        - **base_dir**: Root directory for all Mirrorr state.
            Defaults to "." (the current working directory).
        - **content_dir**: Where video data and session data lives.
            Defaults to "./content/" (relative to working dir).
        - **autoruns_dir**: Subdir inside content_dir for autorun sessions.
            Defaults to "./autoruns/" (relative to working dir).
        - **recordings_dir**: Subdir inside content_dir for recording sessions.
            Defaults to "./recordings/" (relative to working dir).
        - **plugins_dir**: Directory that holds plugin .py files.
            Defaults to "./plugins/" (relative to working dir).
        - **engines_dir**: Directory that holds engine plugin .py files.
            Defaults to "./engines/" (relative to working dir).
        - **resolvers_dir**: Directory that holds resolver plugin .py files.
            Defaults to "./resolvers/" (relative to working dir).
        - **nats_server_dir**: Directory for the local NATS server binary.
            Defaults to "./nats-server/" (relative to working dir).
        - **binaries_dir**: Parent dir for downloaded binaries (NATS, ffmpeg).
            Defaults to "./binaries/" (relative to working dir).
        - **db_file**: Path to the main SQLite database file.
            Defaults to "./mirrorr.db" (relative to working dir).
        - **hls_window**: Number of seconds to keep HLS segments in memory.
            Defaults to 30 (seconds).
        - **segment_duration**: Duration of each HLS segment in seconds.
            Defaults to 10 (seconds).
        - **autorun_check_interval**: Interval in seconds between autorun schedule checks.
            Defaults to 5 (seconds).
        - **web_url**: URL for the web interface.
            Defaults to "" (no web interface).
        - **nats_port**: Port the local NATS server listens on.
            Defaults to 4222.
        - **use_system_ffmpeg**: Use ffmpeg from $PATH instead of bundled.
            Defaults to False.
        - **use_system_nats**: Use nats-server from $PATH instead of bundled.
            Defaults to False.
        - **api_host**: Uvicorn bind address.
            Defaults to "localhost".
        - **api_port**: Uvicorn bind port.
            Defaults to 8000.
    """

    # ── base ───────────────────────────────────────────────────────────
    base_dir: Path = Path(".")

    # ── content ────────────────────────────────────────────────────────
    content_dir: Path = Path(".")
    autoruns_dir: Path = Path(".")
    recordings_dir: Path = Path(".")

    # ── plugins ────────────────────────────────────────────────────────
    plugins_dir: Path = Path(".")
    engines_dir: Path = Path(".")
    resolvers_dir: Path = Path(".")

    # ── binaries / state ───────────────────────────────────────────────
    nats_server_dir: Path = Path(".")
    binaries_dir: Path = Path(".")
    db_file: Path = Path(".")

    # ── HLS ───────────────────────────────────────────────────────────
    hls_window: int = 7200         # sliding manifest duration in seconds
    segment_duration: int = 10    # individual segment duration in seconds

    # ── scheduler ────────────────────────────────────────────────────
    autorun_check_interval: int = 10  # seconds between autorun schedule checks

    # ── web exposure ─────────────────────────────────────────────────
    web_url: str = ""  # required: e.g. https://your-domain.duckdns.org

    # ── behaviour ──────────────────────────────────────────────────────
    nats_port: int = 4222
    use_system_ffmpeg: bool = False
    use_system_nats: bool = False
    api_host: str = "localhost"
    api_port: int = 8000
    dev_serve_files: bool = False  # mount content_dir as static files in uvicorn (dev only)

    # ── validators / computed ──────────────────────────────────────────

    @model_validator(mode="after")
    def _resolve_defaults(self) -> Self:
        """Derive paths from base_dir, then make absolute."""
        b = self.base_dir

        # Derive defaults only if the value is still the sentinel "base_dir".
        # When constructed directly (not via create_from_env), these are all
        # Path(".") which gets overridden here.
        if self.content_dir == Path("."):
            self.content_dir = b / "content"
        if self.autoruns_dir == Path("."):
            self.autoruns_dir = self.content_dir / "autoruns"
        if self.recordings_dir == Path("."):
            self.recordings_dir = self.content_dir / "recordings"
        if self.plugins_dir == Path("."):
            self.plugins_dir = b / "plugins"
        if self.engines_dir == Path("."):
            self.engines_dir = self.plugins_dir / "engines"
        if self.resolvers_dir == Path("."):
            self.resolvers_dir = self.plugins_dir / "resolvers"
        if self.nats_server_dir == Path("."):
            self.nats_server_dir = b / "nats-server"
        if self.binaries_dir == Path("."):
            self.binaries_dir = b / "binaries"
        if self.db_file == Path("."):
            self.db_file = b / "mirrorr_data.db"

        # Ensure all resolved paths are absolute
        for field_name in (
            "content_dir", "autoruns_dir", "recordings_dir",
            "plugins_dir", "engines_dir", "resolvers_dir",
            "nats_server_dir", "binaries_dir", "db_file",
        ):
            setattr(self, field_name, getattr(self, field_name).resolve())

        return self

    @computed_field
    @property
    def nats_url(self) -> str:
        return f"nats://localhost:{self.nats_port}"

    @computed_field
    @property
    def nats_bin_dir(self) -> Path:
        return self.binaries_dir / "nats-server"

    @computed_field
    @property
    def ffmpeg_bin_dir(self) -> Path:
        return self.binaries_dir / "ffmpeg"

    # ── factory ────────────────────────────────────────────────────────

    @classmethod
    def create_from_env(cls, env_file: str | Path = ".env", **overrides: Any) -> Self:
        """Create settings by reading an .env file, then applying overrides.

        This uses pydantic-settings' BaseSettings under the hood so that
        standard env-var / .env-file semantics apply.
        """
        from pydantic_settings import BaseSettings, SettingsConfigDict

        class _EnvSettings(BaseSettings):
            model_config = SettingsConfigDict(
                env_file=str(env_file),
                env_file_encoding="utf-8",
                extra="ignore",
            )
            BASE_DIR: Path = Path(".")

            CONTENT_DIR: Path | None = None
            AUTORUNS_DIR: Path | None = None
            RECORDINGS_DIR: Path | None = None

            PLUGINS_DIR: Path | None = None
            ENGINES_DIR: Path | None = None
            RESOLVERS_DIR: Path | None = None

            NATS_SERVER_DIR: Path | None = None
            BINARIES_DIR: Path | None = None
            DB_FILE: Path | None = None
            HLS_WINDOW: int = 7200
            SEGMENT_DURATION: int = 10
            AUTORUN_CHECK_INTERVAL: int = 10
            NATS_PORT: int = 4222
            USE_SYSTEM_FFMPEG: bool = False
            USE_SYSTEM_NATS: bool = False
            API_HOST: str = "localhost"
            API_PORT: int = 8000
            DEV_SERVE_FILES: bool = False
            WEB_URL: str = ""

            @model_validator(mode="after")
            def _derive_paths(self) -> Self:
                b = self.BASE_DIR
                if self.CONTENT_DIR is None:
                    self.CONTENT_DIR = b / "content"
                if self.AUTORUNS_DIR is None:
                    self.AUTORUNS_DIR = self.CONTENT_DIR / "autoruns"
                if self.RECORDINGS_DIR is None:
                    self.RECORDINGS_DIR = self.CONTENT_DIR / "recordings"
                if self.PLUGINS_DIR is None:
                    self.PLUGINS_DIR = b / "plugins"
                if self.ENGINES_DIR is None:
                    self.ENGINES_DIR = self.PLUGINS_DIR / "engines"
                if self.RESOLVERS_DIR is None:
                    self.RESOLVERS_DIR = self.PLUGINS_DIR / "resolvers"
                if self.NATS_SERVER_DIR is None:
                    self.NATS_SERVER_DIR = b / "nats-server"
                if self.BINARIES_DIR is None:
                    self.BINARIES_DIR = b / "binaries"
                if self.DB_FILE is None:
                    self.DB_FILE = b / "mirrorr_data.db"
                return self

        env = _EnvSettings()

        mapping: dict[str, Any] = {}
        for field_name in (
            "base_dir", "content_dir", "autoruns_dir", "recordings_dir",
            "plugins_dir", "engines_dir", "resolvers_dir", "nats_server_dir",
            "binaries_dir", "db_file", "nats_port", "use_system_ffmpeg",
            "use_system_nats", "api_host", "api_port", "dev_serve_files",
            "hls_window", "segment_duration", "autorun_check_interval",
            "web_url",
        ):
            env_key = field_name.upper()
            val = getattr(env, env_key, None)
            if val is not None:
                mapping[field_name] = val

        mapping.update(overrides)
        return cls(**mapping)

    # ── filesystem helpers ─────────────────────────────────────────────

    def ensure_directories(self) -> None:
        """Create every directory that Mirrorr needs to exist."""
        dirs = [
            self.content_dir,
            self.autoruns_dir,
            self.recordings_dir,
            self.engines_dir,
            self.resolvers_dir,
            self.nats_server_dir,
            self.binaries_dir,
            self.db_file.parent,
        ]
        for d in dirs:
            d.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Module-level `settings` kept for backward compatibility during the
# refactor.  New code should receive a MirrorrSettings instance via
# MirrorrCore instead of importing this singleton.
# ---------------------------------------------------------------------------
# NOTE: settings is intentionally NOT created here anymore.  The old
# `check_dotenv()` + `Settings()` pattern is replaced by MirrorrCore
# receiving MirrorrSettings as a constructor parameter.
