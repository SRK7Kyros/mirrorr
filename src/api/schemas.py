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
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    password: str
    display_name: str = ""


class RefreshRequest(BaseModel):
    refresh_token: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


# ── Sessions ───────────────────────────────────────────────────────────


class CreateSessionRequest(BaseModel):
    profile_id: int | None = None
    engine_id: int
    resolver_id: int
    resolver_config: dict[str, Any] = Field(default_factory=dict)
    retry_mode: str = "none"
    retry_config: dict[str, Any] = Field(default_factory=dict)
    recording: bool = False
    requester_user_token: str = ""


# ── Autoruns ───────────────────────────────────────────────────────────


class CreateAutorunRequest(BaseModel):
    user_friendly_name: str
    snake_case_name: str
    profile_id: int | None = None
    engine_id: int
    resolver_id: int
    resolver_config: dict[str, Any] = Field(default_factory=dict)
    retry_mode: str = "none"
    retry_config: dict[str, Any] = Field(default_factory=dict)
    start_time: datetime
    end_time: datetime
    recording: bool = True
    requester_user_token: str = ""


class UpdateAutorunRequest(BaseModel):
    user_friendly_name: str | None = None
    snake_case_name: str | None = None
    profile_id: int | None = None
    engine_id: int | None = None
    resolver_id: int | None = None
    resolver_config: dict[str, Any] | None = None
    retry_mode: str | None = None
    retry_config: dict[str, Any] | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    recording: bool | None = None
    requester_user_token: str | None = None


# ── Profiles ───────────────────────────────────────────────────────────


class CreateProfileRequest(BaseModel):
    name: str
    default_engine_id: int
    resolver_id: int
    resolver_config: dict[str, Any] = Field(default_factory=dict)
    retry_mode: str = "none"
    retry_config: dict[str, Any] = Field(default_factory=dict)
    requester_user_token: str = ""


class UpdateProfileRequest(BaseModel):
    name: str | None = None
    default_engine_id: int | None = None
    resolver_id: int | None = None
    resolver_config: dict[str, Any] | None = None
    retry_mode: str | None = None
    retry_config: dict[str, Any] | None = None
    requester_user_token: str | None = None


class SaveProfileRequest(BaseModel):
    name: str
