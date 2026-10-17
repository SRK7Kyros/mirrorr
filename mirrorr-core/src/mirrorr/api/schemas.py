"""Pydantic request/response schemas for API endpoints.

These replace the raw `dict[str, Any] = Body(...)` pattern with proper
Pydantic models, enabling:
1. Automatic OpenAPI schema generation
2. Request validation before hitting the endpoint logic
3. Clearer API contracts for frontend integration
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


# ── Auth ───────────────────────────────────────────────────────────────


class LoginRequest(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=128)


class RegisterRequest(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(default="", max_length=128)


class RefreshRequest(BaseModel):
    refresh_token: str


class ChangePasswordRequest(BaseModel):
    old_password: str = Field(max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


# ── Sessions ───────────────────────────────────────────────────────────


class CreateSessionRequest(BaseModel):
    profile_id: int | None = None
    engine_id: int | None = None
    resolver_id: int | None = None
    resolver_config: dict[str, Any] | None = None
    retry_mode: str | None = None
    retry_config: dict[str, Any] | None = None
    recording: bool = False


# ── Autoruns ───────────────────────────────────────────────────────────


class CreateAutorunRequest(BaseModel):
    user_friendly_name: str
    snake_case_name: str = Field(pattern=r'^[a-zA-Z0-9_-]+$')
    profile_id: int | None = None
    engine_id: int | None = None
    resolver_id: int | None = None
    resolver_config: dict[str, Any] | None = None
    retry_mode: str | None = None
    retry_config: dict[str, Any] | None = None
    start_time: datetime
    end_time: datetime
    recording: bool = True


class UpdateAutorunRequest(BaseModel):
    user_friendly_name: str | None = None
    snake_case_name: str | None = Field(default=None, pattern=r'^[a-zA-Z0-9_-]+$')
    profile_id: int | None = None
    engine_id: int | None = None
    resolver_id: int | None = None
    resolver_config: dict[str, Any] | None = None
    retry_mode: str | None = None
    retry_config: dict[str, Any] | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    recording: bool | None = None


# ── Profiles ───────────────────────────────────────────────────────────


class CreateProfileRequest(BaseModel):
    name: str
    default_engine_id: int
    resolver_id: int
    resolver_config: dict[str, Any] = Field(default_factory=dict)
    retry_mode: str = "none"
    retry_config: dict[str, Any] = Field(default_factory=dict)


class UpdateProfileRequest(BaseModel):
    name: str | None = Field(default=None, max_length=128, pattern=r"^[^/\\]*[^./\\][^/\\]*$")
    default_engine_id: int | None = None
    resolver_id: int | None = None
    resolver_config: dict[str, Any] | None = None
    retry_mode: str | None = None
    retry_config: dict[str, Any] | None = None


class SaveProfileRequest(BaseModel):
    name: str = Field(max_length=128, pattern=r"^[^/\\]*[^./\\][^/\\]*$")


# ── Resolver sources ───────────────────────────────────────────────────


class CreateResolverSourceRequest(BaseModel):
    name: str
    resolver_id: int
    resolver_config: dict[str, Any] = Field(default_factory=dict)


class UpdateResolverSourceRequest(BaseModel):
    name: str | None = None
    resolver_id: int | None = None
    resolver_config: dict[str, Any] | None = None


class CreateClientRequest(BaseModel):
    name: str = Field(max_length=128)


# ── Response Models ────────────────────────────────────────────────────


class UserResponse(BaseModel):
    id: int
    username: str
    role: str
    display_name: str


class ClientResponse(BaseModel):
    id: int
    name: str


class AuthResponse(BaseModel):
    user: UserResponse
    client: ClientResponse | None = None
    access_token: str | None = None
    refresh_token: str | None = None


class RegistrationPendingResponse(BaseModel):
    status: str = "pending"
    username: str


class RegistrationRequestResponse(BaseModel):
    id: int
    username: str
    display_name: str = ""
    created_at: datetime | None = None


class DenyRequest(BaseModel):
    reason: str = Field(default="", max_length=512)


class SessionResponse(BaseModel):
    id: int
    profile_id: int | None = None
    autorun_id: int | None = None
    engine_id: int
    resolver_id: int
    resolver_config: dict[str, Any] = Field(default_factory=dict)
    retry_mode: str = "none"
    retry_config: dict[str, Any] = Field(default_factory=dict)
    status: str
    recording: bool = False
    retry_attempts: int = 0
    started_at: datetime | None = None
    ended_at: datetime | None = None
    requester_user_token: str = ""
    session_urls: list[dict[str, str]] = Field(default_factory=list)
    attempts: list[dict[str, Any]] = Field(default_factory=list)
    engine_name: str | None = None
    resolver_name: str | None = None
    profile_name: str | None = None
    autorun_name: str | None = None
    recording_progress: dict[str, Any] | None = None


class AutorunResponse(BaseModel):
    id: int
    user_friendly_name: str
    snake_case_name: str
    profile_id: int | None = None
    engine_id: int
    resolver_id: int
    resolver_config: dict[str, Any] = Field(default_factory=dict)
    retry_mode: str = "none"
    retry_config: dict[str, Any] = Field(default_factory=dict)
    status: str
    start_time: datetime
    end_time: datetime
    recording: bool = True
    requester_user_token: str = ""
    engine_name: str | None = None
    resolver_name: str | None = None
    profile_name: str | None = None
    next_run_at: datetime | None = None
    last_run_at: datetime | None = None


class RecordingResponse(BaseModel):
    id: int
    user_friendly_name: str
    snake_case_name: str
    content_url: str
    profile_name: str
    engine_name: str
    resolver_name: str
    started_at: datetime
    ended_at: datetime
    duration_seconds: float
    size_bytes: int
    created_at: datetime
    requester_user_token: str = ""
    session_id: int | None = None
    media_served: bool = False


class ProfileResponse(BaseModel):
    id: int
    name: str
    default_engine_id: int
    resolver_id: int
    resolver_config: dict[str, Any] = Field(default_factory=dict)
    retry_mode: str = "none"
    retry_config: dict[str, Any] = Field(default_factory=dict)
    requester_user_token: str = ""
    engine_name: str | None = None
    resolver_name: str | None = None


class EngineResponse(BaseModel):
    id: int
    name: str
    description: str = ""
    origin: str
    origin_hash: str
    capabilities: dict[str, Any] = Field(default_factory=dict)
    retry_modes_schema: dict[str, Any] = Field(default_factory=dict)


class ResolverResponse(BaseModel):
    id: int
    name: str
    description: str
    origin: str
    origin_hash: str
    config_schema: dict[str, Any] = Field(default_factory=dict)
    search_schema: dict[str, Any] = Field(default_factory=dict)
    #: True when the plugin declares a browsable catalog (discovery_has_catalog).
    has_catalog: bool = False


# ── Typed list responses (for OpenAPI schema + runtime validation) ────
# Generic PaginatedResponse uses `list[Any]`, which produces no schema for
# the item shape. These typed variants give the frontend a real contract.


class SessionListResponse(BaseModel):
    items: list[SessionResponse]
    next_cursor: int | None = None
    has_more: bool = False
    total: int | None = None


class AutorunListResponse(BaseModel):
    items: list[AutorunResponse]
    next_cursor: int | None = None
    has_more: bool = False
    total: int | None = None


class RecordingListResponse(BaseModel):
    items: list[RecordingResponse]
    next_cursor: int | None = None
    has_more: bool = False
    total: int | None = None


class ProfileListResponse(BaseModel):
    items: list[ProfileResponse]
    next_cursor: int | None = None
    has_more: bool = False
    total: int | None = None


class EngineListResponse(BaseModel):
    items: list[EngineResponse]
    next_cursor: int | None = None
    has_more: bool = False
    total: int | None = None


class ResolverListResponse(BaseModel):
    items: list[ResolverResponse]
    next_cursor: int | None = None
    has_more: bool = False
    total: int | None = None


class DiscoveryRequest(BaseModel):
    query: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)
    cursor: str | None = None


class DiscoveryItemResponse(BaseModel):
    id: str
    title: str
    config: dict[str, Any] = Field(default_factory=dict)
    subtitle: str | None = None
    image: str | None = None
    description: str | None = None
    meta: dict[str, Any] = Field(default_factory=dict)


class DiscoveryResponse(BaseModel):
    items: list[DiscoveryItemResponse] = Field(default_factory=list)
    next_cursor: str | None = None


class ResolverSourceResponse(BaseModel):
    id: int
    name: str
    resolver_id: int
    resolver_config: dict[str, Any] = Field(default_factory=dict)
    requester_user_token: str = ""
    resolver_name: str | None = None


class ResolverSourceListResponse(BaseModel):
    items: list[ResolverSourceResponse]
    next_cursor: int | None = None
    has_more: bool = False
    total: int | None = None


# ── Sharing (the frozen AccessView) ────────────────────────────────────


class GrantEntry(BaseModel):
    """One user's granted capabilities on a resource.

    ``capabilities`` holds ``Capability`` values sorted by the frozen enum
    order (``VIEW, OPERATE, EDIT, DELETE, SHARE, EXPORT``).
    """

    username: str
    capabilities: list[str] = Field(default_factory=list)


class GroupRef(BaseModel):
    """A group named by id — an owner group or a grant holder."""

    id: int
    name: str
    display_name: str = ""
    system: bool = False


class GroupGrantEntry(BaseModel):
    """One group's granted capabilities on a resource.

    Mirror of ``GrantEntry`` for a group principal: ``capabilities`` holds
    ``Capability`` values in the frozen enum order.
    """

    group_id: int
    name: str
    display_name: str = ""
    system: bool = False
    capabilities: list[str] = Field(default_factory=list)


class AccessView(BaseModel):
    """The one sharing shape, served by every ``/shares/`` route.

    ``grants`` excludes the owner (their rights are implicit) and every user
    with no capabilities; ``group_grants`` lists only groups that hold one.
    ``owner_users`` and ``owner_groups`` are the additive user and group owners,
    beside the requester ``owner``; the privileged ``requester_user_token``
    field never appears in this view.
    """

    resource_type: str
    id: int
    owner: str = ""
    owner_missing: bool = False
    grants: list[GrantEntry] = Field(default_factory=list)
    owner_users: list[str] = Field(default_factory=list)
    owner_groups: list[GroupRef] = Field(default_factory=list)
    group_grants: list[GroupGrantEntry] = Field(default_factory=list)


class SetGrantsRequest(BaseModel):
    """Replace-set body: exactly these capabilities for exactly this user."""

    username: str = Field(max_length=64)
    capabilities: list[str] = Field(default_factory=list)


class SetGroupGrantsRequest(BaseModel):
    """Replace-set body for a group: exactly these capabilities for it."""

    capabilities: list[str] = Field(default_factory=list)


# ── Admin: resource access ─────────────────────────────────────────────


class ResourceAccessItem(BaseModel):
    """One row of the admin resource listing: an item, its owner, its viewers."""

    resource_type: str
    id: int
    label: str
    owner: str = ""
    owner_missing: bool = False
    viewer_count: int = 0
    owner_users: list[str] = Field(default_factory=list)
    owner_groups: list[str] = Field(default_factory=list)
    grant_groups: list[str] = Field(default_factory=list)
    system: bool = False


class ResourceAccessListResponse(BaseModel):
    items: list[ResourceAccessItem] = Field(default_factory=list)
    total: int = 0


class TransferOwnerRequest(BaseModel):
    username: str = Field(max_length=64)


class SetOwnerResponse(BaseModel):
    resource_type: str
    id: int
    owner: str


# ── Groups ─────────────────────────────────────────────────────────────


class GroupResponse(BaseModel):
    """One group and its members. ``system`` marks the reserved ``everyone``
    group, whose membership is implicit — its ``members`` are every user."""

    id: int
    name: str
    display_name: str = ""
    system: bool = False
    member_count: int = 0
    members: list[str] = Field(default_factory=list)


class GroupListResponse(BaseModel):
    items: list[GroupResponse] = Field(default_factory=list)
    total: int = 0


class CreateGroupRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    display_name: str = ""


class UpdateGroupRequest(BaseModel):
    name: str | None = None
    display_name: str | None = None


class SetMembersRequest(BaseModel):
    usernames: list[str] = Field(default_factory=list)


class DeleteGroupResponse(BaseModel):
    status: str = "deleted"
    id: int


# ── Logs / progress / delete-result responses ─────────────────────────


class SessionLogsResponse(BaseModel):
    """Tail of a session's process output log."""

    session_id: int
    stream: str
    name: str = ""
    lines: list[str] = Field(default_factory=list)
    next_offset: int = 0
    eof: bool = True


class RecordingProgressResponse(BaseModel):
    """Latest remux progress (same shape as the NATS subject payload)."""

    session_id: int
    progress: dict[str, Any] | None = None
    status: str = ""


class DeleteResultResponse(BaseModel):
    """Result of a resource deletion, including cascade counts."""

    status: str = "deleted"
    deleted: dict[str, int] = Field(default_factory=dict)


