from pydantic import BaseModel, Field
from typing import ClassVar, TypeVar
from datetime import datetime
import uuid

class BaseEvent(BaseModel):
    """Binds a NATS subject string directly to a Pydantic schema."""
    subject: ClassVar[str]
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: datetime = Field(default_factory=datetime.now)
    origin: str = "mirrorr-core"

T = TypeVar("T", bound=BaseEvent)


class SessionCreated(BaseEvent):
    subject: ClassVar[str] = "session.created"
    id: int


class SessionUpdated(BaseEvent):
    subject: ClassVar[str] = "session.updated"
    id: int


class SessionDeleted(BaseEvent):
    subject: ClassVar[str] = "session.deleted"
    id: int


class SessionStarted(BaseEvent):
    subject: ClassVar[str] = "session.started"
    id: int


class SessionStopped(BaseEvent):
    subject: ClassVar[str] = "session.stopped"
    id: int


class SessionCrashed(BaseEvent):
    subject: ClassVar[str] = "session.crashed"
    id: int


# Control channel — sent from API to supervisor processes


class SessionStopRequested(BaseEvent):
    subject: ClassVar[str] = "session.{id}.control"
    id: int
    command: str


class AutorunCreated(BaseEvent):
    subject: ClassVar[str] = "autorun.created"
    id: int


class AutorunUpdated(BaseEvent):
    subject: ClassVar[str] = "autorun.updated"
    id: int


class AutorunDeleted(BaseEvent):
    subject: ClassVar[str] = "autorun.deleted"
    id: int


class RecordingCreated(BaseEvent):
    subject: ClassVar[str] = "recording.created"
    id: int


class RecordingUpdated(BaseEvent):
    subject: ClassVar[str] = "recording.updated"
    id: int


class RecordingDeleted(BaseEvent):
    subject: ClassVar[str] = "recording.deleted"
    id: int


class ProfileCreated(BaseEvent):
    subject: ClassVar[str] = "profile.created"
    id: int


class ProfileUpdated(BaseEvent):
    subject: ClassVar[str] = "profile.updated"
    id: int


class ProfileDeleted(BaseEvent):
    subject: ClassVar[str] = "profile.deleted"
    id: int

class MirrorrEvent:
    """Global catalog of all Mirrorr event types."""
    SESSION_CREATED = SessionCreated
    SESSION_UPDATED = SessionUpdated
    SESSION_DELETED = SessionDeleted
    SESSION_STARTED = SessionStarted
    SESSION_STOPPED = SessionStopped
    SESSION_CRASHED = SessionCrashed
    SESSION_STOP_REQUESTED = SessionStopRequested

    AUTORUN_CREATED = AutorunCreated
    AUTORUN_UPDATED = AutorunUpdated
    AUTORUN_DELETED = AutorunDeleted

    RECORDING_CREATED = RecordingCreated
    RECORDING_UPDATED = RecordingUpdated
    RECORDING_DELETED = RecordingDeleted

    PROFILE_CREATED = ProfileCreated
    PROFILE_UPDATED = ProfileUpdated
    PROFILE_DELETED = ProfileDeleted
