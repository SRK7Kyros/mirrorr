import json
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel
from sqlalchemy import JSON as SAJSON
from sqlmodel import JSON, Column, Field, Relationship, SQLModel, TypeDecorator, Enum as SQLEnum

from src.plugins.interfaces import Capabilities
from src.storage.enums import AutorunStatus, SessionStatus, UserRole


class PydanticJSON(TypeDecorator):
    impl = JSON

    def __init__(self, pydantic_model: type) -> None:
        super().__init__()
        self.pydantic_model = pydantic_model

    def process_bind_param(self, value: Any, dialect: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, BaseModel):
            return value.model_dump()
        if isinstance(value, (dict, list)):
            return value
        if isinstance(value, str):
            try:
                return json.loads(value)
            except (json.JSONDecodeError, TypeError):
                return value
        return value

    def process_result_value(self, value: Any, dialect: Any) -> Any:
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
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    requester_user_token: str = Field(default="")

    subscriptions: list["EventSubscription"] = Relationship(
        sa_relationship_kwargs={
            "primaryjoin": "and_(EventSubscription.resource_type=='recording', foreign(EventSubscription.resource_id)==Recording.id)",
            "cascade": "all, delete-orphan",
        },
    )
    notifications: list["Notification"] = Relationship(
        sa_relationship_kwargs={
            "primaryjoin": "and_(Notification.resource_type=='recording', foreign(Notification.resource_id)==Recording.id)",
            "cascade": "all, delete-orphan",
        },
    )


class Autorun(SQLModel, table=True):
    __tablename__ = "autoruns"

    id: int = Field(default=None, primary_key=True)
    user_friendly_name: str
    snake_case_name: str
    profile_id: int | None = Field(foreign_key="profiles.id", default=None)
    engine_id: int = Field(foreign_key="engines.id")
    resolver_id: int = Field(foreign_key="resolvers.id")
    resolver_config: dict[str, Any] = Field(default_factory=dict, sa_column=Column(SAJSON))
    retry_mode: str = Field(default="none")
    retry_config: dict[str, Any] = Field(default_factory=dict, sa_column=Column(SAJSON))
    status: AutorunStatus = Field(
        default=AutorunStatus.SCHEDULED, sa_column=Column(SQLEnum(AutorunStatus))
    )
    start_time: datetime
    end_time: datetime
    recording: bool = Field(default=True)
    requester_user_token: str = Field(default="")

    session: "Session" = Relationship(back_populates="autorun")
    profile: "Profile" = Relationship(back_populates="autoruns")
    engine: "Engine" = Relationship(back_populates="autoruns")
    resolver: "Resolver" = Relationship(back_populates="autoruns")


class Session(SQLModel, table=True):
    """Represents a session in the database."""
    __tablename__ = "sessions"

    id: int = Field(default=None, primary_key=True)
    profile_id: int | None = Field(foreign_key="profiles.id", default=None)
    autorun_id: int | None = Field(foreign_key="autoruns.id", default=None)
    engine_id: int = Field(foreign_key="engines.id")
    resolver_id: int = Field(foreign_key="resolvers.id")
    resolver_config: dict[str, Any] = Field(default_factory=dict, sa_column=Column(SAJSON))
    retry_mode: str = Field(default="none")
    retry_config: dict[str, Any] = Field(default_factory=dict, sa_column=Column(SAJSON))

    status: SessionStatus = Field(
        default=SessionStatus.ACTIVE, sa_column=Column(SQLEnum(SessionStatus))
    )
    recording: bool = Field(default=False)
    retry_attempts: int = Field(default=0)
    started_at: datetime | None = Field(default=None)
    ended_at: datetime | None = Field(default=None)
    requester_user_token: str
    session_urls: list[dict[str, str]] = Field(default_factory=list, sa_column=Column(SAJSON))
    attempts: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(SAJSON))

    profile: "Profile" = Relationship(back_populates="sessions")
    autorun: "Autorun" = Relationship(back_populates="session")
    engine: "Engine" = Relationship()
    resolver: "Resolver" = Relationship(back_populates="sessions")

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
    sessions: list[Session] = Relationship(back_populates="resolver")
    autoruns: list[Autorun] = Relationship(back_populates="resolver")


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
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    users: list["User"] = Relationship(
        back_populates="clients",
        link_model=ClientUser,
    )


class RefreshTokenRecord(SQLModel, table=True):
    """Tracks issued refresh tokens for revocation support.

    Each row represents one refresh token identified by its JTI claim.
    Revoked tokens are marked but retained until they expire naturally
    to prevent replay attacks.
    """
    __tablename__ = "refresh_tokens"

    jti: str = Field(primary_key=True)  # JWT ID claim
    user_id: int = Field(foreign_key="users.id", index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    expires_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    revoked: bool = Field(default=False)


class User(SQLModel, table=True):
    """A user identity with username/password auth and role-based access.

    Multiple clients can be linked to the same user. The ``username``
    matches the ``requester_user_token`` stored on resources.
    """
    __tablename__ = "users"

    id: int = Field(default=None, primary_key=True)
    username: str = Field(unique=True, index=True)
    password_hash: str = Field(default="")
    role: UserRole = Field(default=UserRole.USER, sa_column=Column(SQLEnum(UserRole)))
    display_name: str = Field(default="")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

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
    resource_type: str = Field(index=True)  # ResourceType enum value: session, autorun, recording, profile
    resource_id: int = Field(index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

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
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    user: "User" = Relationship(back_populates="notifications")
