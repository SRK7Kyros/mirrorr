"""Domain enumerations for Mirrorr.

Extracted from storage.models to reduce that module's scope.
"""

from __future__ import annotations

from enum import Enum as PyEnum


class SessionStatus(str, PyEnum):
    INITIALIZING = "initializing"      # resolver pre-flight (resolve + smoke test) running
    STREAM_PENDING = "stream_pending"  # engine up, playlist not yet on disk
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
    SOURCE = "source"
    USER = "user"


class Capability(str, PyEnum):
    """Per-action rights on an owner-bearing resource.

    Owner and admin hold all six implicitly; everyone else holds only what
    ``resource_access`` grants. VIEW is the base capability — any grant implies
    it — while nothing else is inherited; the declaration order is the frozen
    order used to sort capability lists.
    """
    VIEW = "VIEW"
    OPERATE = "OPERATE"
    EDIT = "EDIT"
    DELETE = "DELETE"
    SHARE = "SHARE"
    EXPORT = "EXPORT"
