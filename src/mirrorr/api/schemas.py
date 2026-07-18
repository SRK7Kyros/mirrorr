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
    engine_id: int
    resolver_id: int
    resolver_config: dict[str, Any] = Field(default_factory=dict)
    retry_mode: str = "none"
    retry_config: dict[str, Any] = Field(default_factory=dict)
    recording: bool = False


# ── Autoruns ───────────────────────────────────────────────────────────


class CreateAutorunRequest(BaseModel):
    user_friendly_name: str
    snake_case_name: str = Field(pattern=r'^[a-zA-Z0-9_-]+$')
    profile_id: int | None = None
    engine_id: int
    resolver_id: int
    resolver_config: dict[str, Any] = Field(default_factory=dict)
    retry_mode: str = "none"
    retry_config: dict[str, Any] = Field(default_factory=dict)
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
    name: str | None = None
    default_engine_id: int | None = None
    resolver_id: int | None = None
    resolver_config: dict[str, Any] | None = None
    retry_mode: str | None = None
    retry_config: dict[str, Any] | None = None


class SaveProfileRequest(BaseModel):
    name: str


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


class RecordingResponse(BaseModel):
    id: int
    user_friendly_name: str
    snake_case_name: str
    disk_path: str
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


class ProfileResponse(BaseModel):
    id: int
    name: str
    default_engine_id: int
    resolver_id: int
    resolver_config: dict[str, Any] = Field(default_factory=dict)
    retry_mode: str = "none"
    retry_config: dict[str, Any] = Field(default_factory=dict)
    requester_user_token: str = ""


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


class PaginatedResponse(BaseModel):
    items: list[Any]
    next_cursor: int | None = None
    has_more: bool = False


# ── Typed list responses (for OpenAPI schema + runtime validation) ────
# Generic PaginatedResponse uses `list[Any]`, which produces no schema for
# the item shape. These typed variants give the frontend a real contract.


class SessionListResponse(BaseModel):
    items: list[SessionResponse]
    next_cursor: int | None = None
    has_more: bool = False


class AutorunListResponse(BaseModel):
    items: list[AutorunResponse]
    next_cursor: int | None = None
    has_more: bool = False


class RecordingListResponse(BaseModel):
    items: list[RecordingResponse]
    next_cursor: int | None = None
    has_more: bool = False


class ProfileListResponse(BaseModel):
    items: list[ProfileResponse]
    next_cursor: int | None = None
    has_more: bool = False


class EngineListResponse(BaseModel):
    items: list[EngineResponse]
    next_cursor: int | None = None
    has_more: bool = False


class ResolverListResponse(BaseModel):
    items: list[ResolverResponse]
    next_cursor: int | None = None
    has_more: bool = False
