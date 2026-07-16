"""Domain enumerations for Mirrorr.

Extracted from storage.models to reduce that module's scope.
"""

from __future__ import annotations

from enum import Enum as PyEnum


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


class UserRole(str, PyEnum):
    """Valid user roles."""
    ADMIN = "admin"
    USER = "user"


class ResourceType(str, PyEnum):
    SESSION = "session"
    PROFILE = "profile"
    AUTORUN = "autorun"
    RECORDING = "recording"
