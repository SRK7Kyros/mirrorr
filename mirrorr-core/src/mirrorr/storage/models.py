import json
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel
from sqlalchemy import JSON as SAJSON, Index, UniqueConstraint
from sqlmodel import JSON, Column, Field, Relationship, SQLModel, TypeDecorator, Enum as SQLEnum

from mirrorr.plugin_api.interfaces import Capabilities
from mirrorr.storage.enums import AutorunStatus, Capability, ResourceType, SessionStatus, UserRole


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
    session_id: int | None = Field(default=None, index=True)

    started_at: datetime
    ended_at: datetime
    duration_seconds: float
    size_bytes: int
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    requester_user_token: str = Field(default="")
    # A group primary owner (at most one of the two is set); see AccessView.
    requester_group_id: int | None = Field(default=None, index=True)

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
    # A group primary owner (at most one of the two is set); see AccessView.
    requester_group_id: int | None = Field(default=None, index=True)
    # What a boot does when it finds this autorun's session mid-flight:
    # "fail" (leave it failed) or "retry" (fail it, then start a fresh one).
    orphan_policy: str = Field(default="fail")
    # Profiles to try, in order, after this autorun's own capture failed while
    # its window was still open. Ids, not rows: each attempt copies its
    # profile's engine/resolver/config at spawn time (see ``autorun_scheduler``).
    fallback_profile_ids: list[int] = Field(default_factory=list, sa_column=Column(SAJSON))
    # Fallbacks that swap only the source: ``{resolver_id, resolver_config}``
    # run on this autorun's own engine and retry policy — what an engine +
    # resolver run can name without inventing a profile for it.
    fallback_sources: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(SAJSON))

    # One-shot schedule — the "next run" is simply start_time until it fires.
    # last_run_at is set when the autorun transitions out of SCHEDULED.
    next_run_at: datetime | None = Field(default=None)
    last_run_at: datetime | None = Field(default=None)

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
        default=SessionStatus.INITIALIZING, sa_column=Column(SQLEnum(SessionStatus))
    )
    recording: bool = Field(default=False)
    retry_attempts: int = Field(default=0)
    started_at: datetime | None = Field(default=None)
    ended_at: datetime | None = Field(default=None)
    requester_user_token: str
    # A group primary owner (at most one of the two is set); see AccessView.
    requester_group_id: int | None = Field(default=None, index=True)
    session_urls: list[dict[str, str]] = Field(default_factory=list, sa_column=Column(SAJSON))
    attempts: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(SAJSON))
    # The profiles this session tries, in order: its own profile first, then any
    # fallbacks. Each capture runs that profile's engine/resolver/config into its
    # own folder, and the captures merge into one recording when the session ends.
    capture_plan: list[int | dict[str, Any] | None] = Field(
        default_factory=list, sa_column=Column(SAJSON)
    )
    # What each capture did: profile/engine/resolver names, status, reason, media.
    captures: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(SAJSON))
    # Absolute path to the session folder; lets API read logs/progress even
    # after the supervisor process exits. Set by the supervisor on start.
    session_folder: str | None = Field(default=None)
    # Latest remux progress as published on session.<id>.remux.progress.
    recording_progress: dict[str, Any] | None = Field(default=None, sa_column=Column(SAJSON))
    # Set by the scheduler: one autorun slot can spawn at most one session.
    idempotency_key: str | None = Field(default=None)

    __table_args__ = (Index("ux_sessions_idempotency_key", "idempotency_key", unique=True),)

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
    # A group primary owner (at most one of the two is set); see AccessView.
    requester_group_id: int | None = Field(default=None, index=True)

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
    search_schema: dict[str, Any] = Field(default_factory=dict, sa_column=Column(SAJSON))
    #: The plugin's discovery_has_catalog: True means the discovery panel can read
    #: a catalog once and filter it in the browser; False is search-only.
    has_catalog: bool = Field(default=False)

    profiles: list[Profile] = Relationship(back_populates="resolver")
    sessions: list[Session] = Relationship(back_populates="resolver")
    autoruns: list[Autorun] = Relationship(back_populates="resolver")
    sources: list["ResolverSource"] = Relationship(back_populates="resolver")


class ResolverSource(SQLModel, table=True):
    """A named, saved resolver config.

    Just a resolver + its config with a name, reusable anywhere a resolver is
    configured (profiles, sessions, autoruns). It is live: loading one fills the
    consumer's resolver section, it is not a link to a running thing."""
    __tablename__ = "resolver_sources"

    id: int = Field(default=None, primary_key=True)
    name: str
    resolver_id: int = Field(foreign_key="resolvers.id")
    resolver_config: dict[str, Any] = Field(default_factory=dict, sa_column=Column(SAJSON))
    requester_user_token: str = Field(default="")
    # A group primary owner (at most one of the two is set); see AccessView.
    requester_group_id: int | None = Field(default=None, index=True)

    resolver: Resolver = Relationship(back_populates="sources")


class ResourceAccess(SQLModel, table=True):
    """A per-user **capability** grant on a resource.

    An item is readable by its owner (``requester_user_token``), the users
    granted here, and admins. Owner and admin hold all six capabilities
    implicitly; a grant gives everyone else the granted capabilities
    (``VIEW``, ``OPERATE``, ``EDIT``, ``DELETE``, ``SHARE``, ``EXPORT``).
    ``VIEW`` is the base capability — any grant implies it — and nothing else is
    inherited; the row set is the whole of their rights.

    A grant names exactly one principal — a user (``username`` set, ``group_id``
    NULL) or a group (``group_id`` set, ``username`` NULL). SQLite treats NULLs
    as distinct in a UNIQUE, so each constraint below is vacuous for the other
    kind's rows and the pair still yields one row per (principal, capability).

    ``username`` matches ``User.username`` without a FK (same convention as
    ``requester_user_token``): a user row that is later deleted leaves an inert
    grant behind, and an owner row that is gone shows up as ``owner_missing``
    on the admin surface. A group grant follows the group by ``group_id``, so
    renaming a group costs nothing and a deleted group drops its own rows.
    """
    __tablename__ = "resource_access"
    __table_args__ = (
        UniqueConstraint("resource_type", "resource_id", "username", "capability"),
        UniqueConstraint("resource_type", "resource_id", "group_id", "capability"),
    )

    id: int | None = Field(default=None, primary_key=True)
    resource_type: ResourceType = Field(sa_column=Column(SQLEnum(ResourceType), index=True))
    resource_id: int = Field(index=True)
    username: str | None = Field(default=None, index=True)
    group_id: int | None = Field(default=None, index=True)
    capability: Capability = Field(
        default=Capability.VIEW, sa_column=Column(SQLEnum(Capability), index=True)
    )
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


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
    # Bumped on password change so existing access tokens are invalidated
    # even before their 24h expiry elapses. The JWT carries the same claim
    # and is rejected if it doesn't match the current value.
    credentials_version: int = Field(default=0)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    clients: list["Client"] = Relationship(
        back_populates="users",
        link_model=ClientUser,
    )
    subscriptions: list["EventSubscription"] = Relationship(back_populates="user")
    notifications: list["Notification"] = Relationship(back_populates="user")


class RegistrationRequest(SQLModel, table=True):
    """A pending public registration request awaiting admin approval.

    Created by POST /auth/register when users already exist and the
    caller is not an admin. Approved requests mint a real User row;
    denied requests are deleted (name freed for reuse).
    """
    __tablename__ = "registration_requests"

    id: int = Field(default=None, primary_key=True)
    username: str = Field(index=True)
    username_normalized: str = Field(unique=True, index=True)
    password_hash: str = Field(default="")
    display_name: str = Field(default="")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


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


EVERYONE_GROUP_NAME = "everyone"
"""The reserved base group: every authenticated user is a member.

Seeded by ``ensure_db`` and never creatable, renamable or deletable through the
API. It has no ``group_members`` rows at all — "every authenticated user" is
resolved in the permission predicate, so a user created tomorrow is a member
with no bookkeeping and no new-user hook.
"""


class Group(SQLModel, table=True):
    """A named set of users that can own items and hold capability grants."""
    __tablename__ = "groups"

    id: int = Field(default=None, primary_key=True)
    name: str = Field(unique=True, index=True)
    display_name: str = Field(default="")
    system: bool = Field(default=False)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class GroupMember(SQLModel, table=True):
    """One user's membership in one group.

    ``username`` matches ``User.username`` without a FK (the same convention as
    ``resource_access.username``), so a deleted user leaves an inert row that
    ``deleteUser`` cleans up; ``deleteGroup`` drops a group's rows.
    """
    __tablename__ = "group_members"
    __table_args__ = (
        UniqueConstraint("group_id", "username"),
    )

    id: int | None = Field(default=None, primary_key=True)
    group_id: int = Field(index=True)
    username: str = Field(index=True)


class ResourceOwnerGroup(SQLModel, table=True):
    """An additive *group* owner of one resource.

    Ownership is additive: the primary owner — the user in
    ``requester_user_token``, or the group in ``requester_group_id`` — is
    untouched and each row here gives every member of the group all six
    capabilities on the item, exactly like the owner. Keyed by ``group_id``, so
    renaming a group needs no cascade.
    """
    __tablename__ = "resource_owner_groups"
    __table_args__ = (
        UniqueConstraint("resource_type", "resource_id", "group_id"),
    )

    id: int | None = Field(default=None, primary_key=True)
    resource_type: ResourceType = Field(sa_column=Column(SQLEnum(ResourceType), index=True))
    resource_id: int = Field(index=True)
    group_id: int = Field(index=True)


class ResourceOwnerUser(SQLModel, table=True):
    """An additive *user* owner of one resource.

    Owners are a list: the primary owner — the user in ``requester_user_token``,
    or the group in ``requester_group_id`` — always owns the item, and every row
    here gives that user all six capabilities on it, exactly like the owner.
    ``username`` matches ``User.username`` without a FK (the ``resource_access``
    convention), so a deleted user's row is inert until ``deleteUser`` clears it.
    """
    __tablename__ = "resource_owner_users"
    __table_args__ = (
        UniqueConstraint("resource_type", "resource_id", "username"),
    )

    id: int | None = Field(default=None, primary_key=True)
    resource_type: ResourceType = Field(sa_column=Column(SQLEnum(ResourceType), index=True))
    resource_id: int = Field(index=True)
    username: str = Field(index=True)
