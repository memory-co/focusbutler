from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models import CameraStatus, DistractionSource, SessionStatus


class UserSettings(BaseModel):
    focus_minutes: int = Field(25, ge=1, le=180)
    short_break_minutes: int = Field(5, ge=1, le=60)
    long_break_minutes: int = Field(15, ge=1, le=120)
    long_break_every: int = Field(4, ge=1, le=12)
    video_chunk_seconds: int = Field(10, ge=3, le=60)
    video_width: int = Field(640, ge=160, le=1920)
    video_height: int = Field(480, ge=120, le=1080)


class UserSettingsPatch(BaseModel):
    focus_minutes: int | None = Field(None, ge=1, le=180)
    short_break_minutes: int | None = Field(None, ge=1, le=60)
    long_break_minutes: int | None = Field(None, ge=1, le=120)
    long_break_every: int | None = Field(None, ge=1, le=12)
    video_chunk_seconds: int | None = Field(None, ge=3, le=60)
    video_width: int | None = Field(None, ge=160, le=1920)
    video_height: int | None = Field(None, ge=120, le=1080)


class Credentials(BaseModel):
    username: str = Field(pattern=r"^[A-Za-z0-9_]{3,32}$")
    password: str = Field(min_length=8, max_length=128)


class UserOut(BaseModel):
    id: str
    username: str
    settings: UserSettings
    created_at: datetime


class SessionCreate(BaseModel):
    camera_status: CameraStatus
    planned_seconds: int | None = Field(None, ge=60, le=180 * 60)


class SessionEnd(BaseModel):
    note: str | None = Field(None, max_length=2000)


class DistractionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    session_id: str
    occurred_at: datetime
    offset_seconds: int
    source: DistractionSource


class VideoChunkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    seq: int
    offset_seconds: int
    duration_seconds: float
    size_bytes: int
    mime_type: str


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    camera_status: CameraStatus
    planned_seconds: int
    started_at: datetime
    ended_at: datetime | None
    status: SessionStatus
    paused_seconds: int
    paused_at: datetime | None
    note: str | None
    distraction_count: int
    elapsed_seconds: int  # 服务端计算的已专注秒数（去掉暂停），前端以此校准
    server_now: datetime


class SessionDetail(SessionOut):
    distractions: list[DistractionOut]
    chunks: list[VideoChunkOut]


class SessionPage(BaseModel):
    items: list[SessionOut]
    page: int
    size: int
    total: int


class StatsSummary(BaseModel):
    days: int
    completed_sessions: int
    abandoned_sessions: int
    focus_minutes: int
    distractions: int
    distractions_per_session: float


class DailyStat(BaseModel):
    date: str
    completed_sessions: int
    focus_minutes: int
    distractions: int


class HeatmapBucket(BaseModel):
    minute: int
    count: int
