import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import BigInteger, Enum, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.mysql import CHAR, DATETIME
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

TABLE_ARGS = {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4"}


def new_id() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    # MySQL DATETIME 不带时区，全库统一存 UTC naive
    return datetime.now(timezone.utc).replace(tzinfo=None)


class SessionStatus(str, enum.Enum):
    running = "running"
    paused = "paused"
    completed = "completed"
    abandoned = "abandoned"


class CameraStatus(str, enum.Enum):
    recording = "recording"
    unavailable = "unavailable"
    denied = "denied"


class DistractionSource(str, enum.Enum):
    button = "button"
    auto = "auto"


class User(Base):
    __tablename__ = "users"
    __table_args__ = TABLE_ARGS

    id: Mapped[str] = mapped_column(CHAR(36), primary_key=True, default=new_id)
    username: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(100), nullable=False)
    settings_json: Mapped[str] = mapped_column("settings", Text, nullable=False)  # 5.6 没有 JSON 类型
    created_at: Mapped[datetime] = mapped_column(DATETIME(fsp=3), nullable=False, default=utcnow)


class PomodoroSession(Base):
    __tablename__ = "pomodoro_sessions"
    __table_args__ = (Index("idx_user_started", "user_id", "started_at"), TABLE_ARGS)

    id: Mapped[str] = mapped_column(CHAR(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(CHAR(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    camera_status: Mapped[CameraStatus] = mapped_column(Enum(CameraStatus, native_enum=True), nullable=False)
    planned_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    started_at: Mapped[datetime] = mapped_column(DATETIME(fsp=3), nullable=False, default=utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(DATETIME(fsp=3), nullable=True)
    status: Mapped[SessionStatus] = mapped_column(Enum(SessionStatus, native_enum=True), nullable=False)
    paused_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    paused_at: Mapped[datetime | None] = mapped_column(DATETIME(fsp=3), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    distraction_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DATETIME(fsp=3), nullable=False, default=utcnow)

    distractions: Mapped[list["DistractionEvent"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="DistractionEvent.offset_seconds"
    )
    chunks: Mapped[list["VideoChunk"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="VideoChunk.seq"
    )


class DistractionEvent(Base):
    __tablename__ = "distraction_events"
    __table_args__ = (
        Index("idx_session", "session_id"),
        Index("idx_user_occurred", "user_id", "occurred_at"),
        TABLE_ARGS,
    )

    id: Mapped[str] = mapped_column(CHAR(36), primary_key=True, default=new_id)
    session_id: Mapped[str] = mapped_column(
        CHAR(36), ForeignKey("pomodoro_sessions.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(CHAR(36), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DATETIME(fsp=3), nullable=False, default=utcnow)
    offset_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    source: Mapped[DistractionSource] = mapped_column(
        Enum(DistractionSource, native_enum=True), nullable=False, default=DistractionSource.button
    )
    created_at: Mapped[datetime] = mapped_column(DATETIME(fsp=3), nullable=False, default=utcnow)

    session: Mapped[PomodoroSession] = relationship(back_populates="distractions")


class VideoChunk(Base):
    __tablename__ = "video_chunks"
    __table_args__ = (UniqueConstraint("session_id", "seq", name="uk_session_seq"), TABLE_ARGS)

    id: Mapped[str] = mapped_column(CHAR(36), primary_key=True, default=new_id)
    session_id: Mapped[str] = mapped_column(
        CHAR(36), ForeignKey("pomodoro_sessions.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[str] = mapped_column(CHAR(36), nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    offset_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    duration_seconds: Mapped[float] = mapped_column(Float, nullable=False)
    path: Mapped[str] = mapped_column(String(255), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DATETIME(fsp=3), nullable=False, default=utcnow)

    session: Mapped[PomodoroSession] = relationship(back_populates="chunks")
