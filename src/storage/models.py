import asyncio
import json
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum as PyEnum
from pathlib import Path
from typing import Any, Generic, Type, TypeVar

from loguru import logger
from pydantic import BaseModel, model_validator
from sqlalchemy import JSON as SAJSON
from sqlmodel import JSON, Column, Field, Relationship, SQLModel, TypeDecorator, Enum as SQLEnum

from src.services.process_bus import ProcessBus, EngineCrashed
from src.services.managed_process import ManagedProcess


# ═══════════════════════════════════════════════════════════════════════
# Plugin types — no DB dependencies, used by engine/resolver plugins
# ═══════════════════════════════════════════════════════════════════════

ConfigT = TypeVar("ConfigT", bound=BaseModel)


# ── Generic retry mode schemas ────────────────────────────────────────

class NoRetry(BaseModel):
    """Retry mode: do not retry on crash."""
    pass


class RetryAlways(BaseModel):
    """Retry mode: always restart on crash."""
    pass


class RetryCount(BaseModel):
    """Retry mode: restart up to N times with optional delay."""
    count: int = Field(default=3, ge=1, description="Maximum number of retry attempts")
    delay: float = Field(default=5.0, ge=0, description="Seconds to wait before retrying")


class RetryOnExitCode(BaseModel):
    """Retry mode: only retry when the process exits with specific codes."""
    codes: list[int] = Field(default=[1], description="Exit codes that should trigger a retry")
    delay: float = Field(default=5.0, ge=0, description="Seconds to wait before retrying")


def build_retry_modes_schema(modes: dict[str, type[BaseModel]]) -> dict[str, Any]:
    """Generate the serializable schema dict for a set of retry modes."""
    return {
        key: {
            "schema": model.model_json_schema(),
            "default_params": model().model_dump(),
        }
        for key, model in modes.items()
    }


def get_retry_delay(mode: str, config: dict[str, Any]) -> float:
    """Extract the retry delay for a given mode+config, or 0 if not applicable."""
    if mode in ("count", "exit_code"):
        return float(config.get("delay", 5.0))
    return 0.0


def get_retry_max_attempts(mode: str, config: dict[str, Any]) -> int | None:
    """Return max attempts for 'count' mode, or None for infinite."""
    if mode == "count":
        return int(config.get("count", 3))
    if mode in ("always", "exit_code"):
        return None  # infinite
    return 0  # no retry


def get_retryable_exit_codes(mode: str, config: dict[str, Any]) -> list[int] | None:
    """Return the list of retryable exit codes for 'exit_code' mode, or None."""
    if mode == "exit_code":
        return config.get("codes", [1])
    return None


@dataclass
class Source:
    """The result of a resolver's work: a direct URL + optional headers
    that an engine can consume to start ingesting a stream."""
    url: str
    headers: dict[str, str] | None = None


class Capabilities(BaseModel):
    """What an engine can do. Must be a Pydantic model for DB serialization."""
    can_record: bool = False
    can_playlist: bool = False


@dataclass
class EngineContext:
    """Runtime environment provided to an engine by the supervisor."""
    bus: ProcessBus
    session_folder: Path
    logs_folder: Path
    segments_folder: Path
    hls_window: int = 60
    segment_duration: int = 10
    _tasks: list[asyncio.Task] = field(default_factory=list)


@dataclass
class ResolverContext:
    """Runtime environment provided to a resolver by the supervisor."""
    bus: ProcessBus
    session_folder: Path


class EngineInterface(ABC):
    """Interface that every engine plugin must implement.

    An engine is responsible for:
    - Defining its capabilities
    - Defining retry modes it supports (and their parameter schemas)
    - Starting processes that produce HLS output
    - Defining what happens when processes exit (retry, crash, complete)
    - Signaling ``engine.done`` or ``engine.crashed`` to the supervisor
    """

    @property
    @abstractmethod
    def name(self) -> str:
        ...

    @property
    @abstractmethod
    def description(self) -> str:
        ...

    @property
    @abstractmethod
    def capabilities(self) -> Capabilities:
        ...

    @property
    def retry_modes(self) -> dict[str, type[BaseModel]]:
        """Map of mode_key → Pydantic model class defining parameters.
        Override to customize which retry modes are available.
        Default: no retry, retry always, retry N times."""
        return {
            "none": NoRetry,
            "always": RetryAlways,
            "count": RetryCount,
            "exit_code": RetryOnExitCode,
        }

    @abstractmethod
    async def start(self, context: EngineContext, source: Source) -> list[ManagedProcess]:
        ...

    async def stop(self, context: EngineContext, reason: str = "stop") -> None:
        """Called when the session is being cleaned up.

        reason is one of:
        - "stop": user requested stop or session completed normally
        - "retry": crashed, about to retry
        - "failed": crashed, giving up

        Override to run engine-specific cleanup (flush remote buffers,
        kill sidecars, etc). The supervisor will cancel your tasks
        and terminate processes after this returns."""
        ...

    async def should_retry(
        self,
        crash: EngineCrashed,
        attempt: int,
        config: dict[str, Any],
    ) -> tuple[bool, float]:
        """Decide whether to retry after a crash.

        Called by the supervisor after each crash. Returns (retry, delay).
        - retry=True, delay=N: retry after N seconds
        - retry=False: give up, mark session as FAILED

        Default implementation handles none/always/count/exit_code modes
        using the session's retry_mode + retry_config. Engines can override
        this to implement any custom retry logic (e.g. backoff, per-error
        classification, adaptive retries)."""
        from src.storage.models import (
            get_retry_max_attempts,
            get_retry_delay,
            get_retryable_exit_codes,
        )

        mode = config.get("mode", "none")
        params = config.get("params", {})
        retryable_codes = get_retryable_exit_codes(mode, params)

        # exit_code mode: only retry if the exit code matches
        if retryable_codes is not None:
            rc = crash.returncode
            if rc is not None and rc in retryable_codes:
                return True, get_retry_delay(mode, params)
            return False, 0.0

        # none/always/count modes
        max_attempts = get_retry_max_attempts(mode, params)
        if max_attempts is not None and attempt >= max_attempts:
            return False, 0.0

        if mode == "none":
            return False, 0.0

        return True, get_retry_delay(mode, params)


class ResolverInterface(ABC, Generic[ConfigT]):
    """Interface that every resolver plugin must implement.

    A resolver is responsible for:
    - Validating its configuration
    - Resolving a high-level config into a direct ``Source``
    - Optionally running ongoing processes (proxies, scrapers) and
      emitting events to the bus when conditions change
    """

    @property
    @abstractmethod
    def name(self) -> str:
        ...

    @property
    @abstractmethod
    def description(self) -> str:
        ...

    @property
    @abstractmethod
    def config_model(self) -> Type[ConfigT]:
        ...

    @abstractmethod
    async def resolve(self, config: ConfigT, context: ResolverContext) -> Source:
        """Resolve config into a Source. Can emit ``engine.restart`` on the
        bus to tell the engine to re-resolve (e.g., URL expiry)."""
        ...

    def stop(self, context: ResolverContext) -> None:
        """Called when the supervisor shuts down. Override to clean up."""
        ...


# ═══════════════════════════════════════════════════════════════════════
# Database models — SQLModel tables, depend on plugin types above
# ═══════════════════════════════════════════════════════════════════════

class SessionStatus(str, PyEnum):
    ACTIVE = "active"
    RECORDING = "recording"
    TERMINATING = "terminating"
    REMUXING = "remuxing"
    FINALIZING = "finalizing"
    COMPLETED = "completed"
    FAILED = "failed"


class AutorunStatus(str, PyEnum):
    SCHEDULED = "scheduled"
    ACTIVE = "active"
    RECORDING = "recording"
    TERMINATING = "terminating"
    REMUXING = "remuxing"
    FINALIZING = "finalizing"
    COMPLETED = "completed"
    FAILED = "failed"


class ResourceType(str, PyEnum):
    SESSION = "session"
    PROFILE = "profile"
    AUTORUN = "autorun"
    RECORDING = "recording"


class PydanticJSON(TypeDecorator):
    impl = JSON

    def __init__(self, pydantic_model):
        super().__init__()
        self.pydantic_model = pydantic_model

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, BaseModel):
            return value.model_dump()
        if isinstance(value, (dict, list)):
            return value
        if isinstance(value, str):
            return json.loads(value)
        return value

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, (dict, list)):
            return self.pydantic_model.model_validate(value)
        return self.pydantic_model.model_validate_json(value)


class Recording(SQLModel, table=True):
    __tablename__ = "recordings"

    id: int = Field(default=None, primary_key=True)
    user_friendly_name: str
    snake_case_name: str
    disk_path: str
    content_url: str

    # anagrafic — snapshot of what produced this recording
    profile_name: str
    engine_name: str
    resolver_name: str

    started_at: datetime
    ended_at: datetime
    duration_seconds: float
    size_bytes: int
    created_at: datetime = Field(default_factory=datetime.now)
    requester_user_token: str = Field(default="")

    subscriptions: list["EventSubscription"] = Relationship(
        sa_relationship_kwargs={"primaryjoin": "and_(EventSubscription.resource_type=='recording', foreign(EventSubscription.resource_id)==Recording.id)"},
    )
    notifications: list["Notification"] = Relationship(
        sa_relationship_kwargs={"primaryjoin": "and_(Notification.resource_type=='recording', foreign(Notification.resource_id)==Recording.id)"},
    )


class Autorun(SQLModel, table=True):
    __tablename__ = "autoruns"

    id: int = Field(default=None, primary_key=True)
    user_friendly_name: str
    snake_case_name: str
    profile_id: int = Field(foreign_key="profiles.id")
    engine_id: int = Field(foreign_key="engines.id")
    status: AutorunStatus = Field(
        default=AutorunStatus.SCHEDULED, sa_column=Column(SQLEnum(AutorunStatus))
    )
    start_time: datetime
    end_time: datetime
    recording: bool = Field(default=True)
    retry_mode_override: str | None = Field(default=None)
    retry_config_override: dict[str, Any] | None = Field(default=None, sa_column=Column(SAJSON))
    requester_user_token: str = Field(default="")

    session: "Session" = Relationship(back_populates="autorun")
    profile: "Profile" = Relationship(back_populates="autoruns")
    engine: "Engine" = Relationship(back_populates="autoruns")


class Session(SQLModel, table=True):
    """Represents a session in the database."""
    __tablename__ = "sessions"

    id: int = Field(default=None, primary_key=True)
    profile_id: int = Field(foreign_key="profiles.id")
    autorun_id: int | None = Field(foreign_key="autoruns.id", default=None)
    engine_id: int = Field(foreign_key="engines.id")

    status: SessionStatus = Field(
        default=SessionStatus.ACTIVE, sa_column=Column(SQLEnum(SessionStatus))
    )
    recording: bool = Field(default=False)
    retry_mode_override: str | None = Field(default=None)
    retry_config_override: dict[str, Any] | None = Field(default=None, sa_column=Column(SAJSON))
    retry_attempts: int = Field(default=0)
    started_at: datetime | None = Field(default=None)
    ended_at: datetime | None = Field(default=None)
    requester_user_token: str
    session_urls: list[dict[str, str]] = Field(default_factory=list, sa_column=Column(SAJSON))

    profile: "Profile" = Relationship(back_populates="sessions")
    autorun: "Autorun" = Relationship(back_populates="session")
    engine: "Engine" = Relationship()

    @property
    def is_autorun(self) -> bool:
        return self.autorun_id is not None

    def effective_retry_mode(self) -> str:
        """Session override if set, otherwise fall back to profile default."""
        if self.retry_mode_override is not None:
            return self.retry_mode_override
        if self.profile:
            return self.profile.retry_mode
        return "none"

    def effective_retry_config(self) -> dict[str, Any]:
        """Session override if set, otherwise fall back to profile default."""
        if self.retry_config_override is not None:
            return self.retry_config_override
        if self.profile:
            return self.profile.retry_config
        return {}


class Profile(SQLModel, table=True):
    __tablename__ = "profiles"

    id: int = Field(default=None, primary_key=True)
    name: str
    default_engine_id: int = Field(foreign_key="engines.id")
    resolver_id: int = Field(foreign_key="resolvers.id")
    resolver_config: dict[str, Any] = Field(default_factory=dict, sa_type=JSON)
    retry_mode: str = Field(default="none")
    retry_config: dict[str, Any] = Field(default_factory=dict, sa_column=Column(SAJSON))
    requester_user_token: str = Field(default="")

    sessions: list["Session"] = Relationship(back_populates="profile")
    autoruns: list["Autorun"] = Relationship(back_populates="profile")
    default_engine: "Engine" = Relationship(back_populates="defaulted_by_profiles")
    resolver: "Resolver" = Relationship(back_populates="profiles")


class Engine(SQLModel, table=True):
    __tablename__ = "engines"

    id: int = Field(default=None, primary_key=True)
    name: str
    description: str = Field(default="")
    origin: str
    origin_hash: str
    capabilities: Capabilities = Field(
        default_factory=Capabilities, sa_column=Column(PydanticJSON(Capabilities))
    )
    retry_modes_schema: dict[str, Any] = Field(default_factory=dict, sa_column=Column(SAJSON))

    defaulted_by_profiles: list[Profile] = Relationship(back_populates="default_engine")
    autoruns: list["Autorun"] = Relationship(back_populates="engine")


class Resolver(SQLModel, table=True):
    __tablename__ = "resolvers"

    id: int = Field(default=None, primary_key=True)
    name: str
    description: str
    origin: str
    origin_hash: str
    config_schema: dict[str, Any] = Field(default_factory=dict, sa_column=Column(SAJSON))

    profiles: list[Profile] = Relationship(back_populates="resolver")


# ═══════════════════════════════════════════════════════════════════════
# Auth — generic client/user identity and notification system
# ═══════════════════════════════════════════════════════════════════════

class ClientUser(SQLModel, table=True):
    """Many-to-many: clients ↔ users."""
    __tablename__ = "client_users"

    client_id: int = Field(foreign_key="clients.id", primary_key=True)
    user_id: int = Field(foreign_key="users.id", primary_key=True)


class Client(SQLModel, table=True):
    """An API client identified by an API key.

    A client can be linked to many users. The API key is the sole
    authentication credential — no passwords, no sessions.
    """
    __tablename__ = "clients"

    id: int = Field(default=None, primary_key=True)
    name: str  # human-readable label, e.g. "Discord Bot", "Web Dashboard"
    api_key_hash: str  # SHA-256 of the raw API key
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=datetime.now)

    users: list["User"] = Relationship(
        back_populates="clients",
        link_model=ClientUser,
    )


class User(SQLModel, table=True):
    """A user identity with username/password auth and role-based access.

    Multiple clients can be linked to the same user. The ``username``
    matches the ``requester_user_token`` stored on resources.
    """
    __tablename__ = "users"

    id: int = Field(default=None, primary_key=True)
    username: str = Field(unique=True, index=True)
    password_hash: str = Field(default="")
    role: str = Field(default="user")  # "admin" or "user"
    display_name: str = Field(default="")
    created_at: datetime = Field(default_factory=datetime.now)

    clients: list["Client"] = Relationship(
        back_populates="users",
        link_model=ClientUser,
    )
    subscriptions: list["EventSubscription"] = Relationship(back_populates="user")
    notifications: list["Notification"] = Relationship(back_populates="user")


class EventSubscription(SQLModel, table=True):
    """Tracks which users have interest in which resources.

    Created automatically when a user creates/touches a resource.
    Used to route notifications to the right users.
    """
    __tablename__ = "event_subscriptions"

    id: int = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    resource_type: str = Field(index=True)  # ResourceType enum value
    resource_id: int = Field(index=True)
    created_at: datetime = Field(default_factory=datetime.now)

    user: "User" = Relationship(back_populates="subscriptions")


class Notification(SQLModel, table=True):
    """A notification toast for a user, triggered by a major event."""
    __tablename__ = "notifications"

    id: int = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    resource_type: str  # ResourceType enum value
    resource_id: int
    event_type: str  # e.g. "session.started", "recording.completed"
    title: str
    body: str = Field(default="")
    read: bool = Field(default=False)
    created_at: datetime = Field(default_factory=datetime.now)

    user: "User" = Relationship(back_populates="notifications")
