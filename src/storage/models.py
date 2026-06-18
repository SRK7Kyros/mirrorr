import asyncio
import json
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum as PyEnum
from pathlib import Path
from typing import Any, Generic, Type, TypeVar

from pydantic import BaseModel, model_validator
from sqlalchemy import JSON as SAJSON
from sqlmodel import JSON, Column, Field, Relationship, SQLModel, TypeDecorator, Enum as SQLEnum

from src.services.process_bus import ProcessBus
from src.services.managed_process import ManagedProcess


# ═══════════════════════════════════════════════════════════════════════
# Plugin types — no DB dependencies, used by engine/resolver plugins
# ═══════════════════════════════════════════════════════════════════════

ConfigT = TypeVar("ConfigT", bound=BaseModel)


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

    @abstractmethod
    async def start(self, context: EngineContext, source: Source) -> list[ManagedProcess]:
        ...

    async def stop(self, context: EngineContext) -> None:
        ...


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
    REMUXING = "remuxing"
    COMPLETED = "completed"
    FAILED = "failed"


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


class Autorun(SQLModel, table=True):
    __tablename__ = "autoruns"

    id: int = Field(default=None, primary_key=True)
    user_friendly_name: str
    snake_case_name: str
    profile_id: int = Field(foreign_key="profiles.id")
    engine_id: int = Field(foreign_key="engines.id")
    start_time: datetime
    end_time: datetime
    recording: bool = Field(default=True)

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


class Profile(SQLModel, table=True):
    __tablename__ = "profiles"

    id: int = Field(default=None, primary_key=True)
    name: str
    default_engine_id: int = Field(foreign_key="engines.id")
    resolver_id: int = Field(foreign_key="resolvers.id")
    resolver_config: dict[str, Any] = Field(default_factory=dict, sa_type=JSON)

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

    defaulted_by_profiles: list[Profile] = Relationship(back_populates="default_engine")
    autoruns: list["Autorun"] = Relationship(back_populates="engine")


class Resolver(SQLModel, table=True):
    __tablename__ = "resolvers"

    id: int = Field(default=None, primary_key=True)
    name: str
    description: str
    origin: str
    origin_hash: str

    profiles: list[Profile] = Relationship(back_populates="resolver")
