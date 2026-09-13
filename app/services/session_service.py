"""番茄会话状态机与走神事件的业务逻辑。"""

from datetime import datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    CameraStatus,
    DistractionEvent,
    DistractionSource,
    PomodoroSession,
    SessionStatus,
    User,
    utcnow,
)
from app.schemas import SessionDetail, SessionOut

ACTIVE = (SessionStatus.running, SessionStatus.paused)
DEBOUNCE = timedelta(seconds=2)


def elapsed_seconds(s: PomodoroSession, now: datetime | None = None) -> int:
    """已专注秒数：去掉累计暂停；正在暂停中则只算到暂停那一刻。"""
    now = now or utcnow()
    end = s.ended_at or (s.paused_at if s.status == SessionStatus.paused else now)
    return max(0, int((end - s.started_at).total_seconds()) - s.paused_seconds)


def to_out(s: PomodoroSession, now: datetime | None = None) -> SessionOut:
    now = now or utcnow()
    return SessionOut(
        id=s.id,
        camera_status=s.camera_status,
        planned_seconds=s.planned_seconds,
        started_at=s.started_at,
        ended_at=s.ended_at,
        status=s.status,
        paused_seconds=s.paused_seconds,
        paused_at=s.paused_at,
        note=s.note,
        distraction_count=s.distraction_count,
        elapsed_seconds=elapsed_seconds(s, now),
        server_now=now,
    )


def to_detail(s: PomodoroSession) -> SessionDetail:
    base = to_out(s)
    return SessionDetail(**base.model_dump(), distractions=s.distractions, chunks=s.chunks)


async def get_active(db: AsyncSession, user_id: str) -> PomodoroSession | None:
    q = select(PomodoroSession).where(PomodoroSession.user_id == user_id, PomodoroSession.status.in_(ACTIVE))
    return (await db.execute(q)).scalars().first()


async def get_owned(db: AsyncSession, user: User, session_id: str) -> PomodoroSession:
    s = await db.get(PomodoroSession, session_id)
    # 不属于自己的会话一律 404，避免枚举
    if s is None or s.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "会话不存在")
    return s


async def create(db: AsyncSession, user: User, camera_status: CameraStatus, planned_seconds: int) -> PomodoroSession:
    if await get_active(db, user.id):
        raise HTTPException(status.HTTP_409_CONFLICT, "已有进行中的番茄")
    s = PomodoroSession(
        user_id=user.id,
        camera_status=camera_status,
        planned_seconds=planned_seconds,
        status=SessionStatus.running,
        started_at=utcnow(),
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return s


def _require(s: PomodoroSession, *allowed: SessionStatus) -> None:
    if s.status not in allowed:
        raise HTTPException(status.HTTP_409_CONFLICT, f"当前状态 {s.status.value} 不允许此操作")


async def pause(db: AsyncSession, s: PomodoroSession) -> PomodoroSession:
    _require(s, SessionStatus.running)
    s.status = SessionStatus.paused
    s.paused_at = utcnow()
    await db.commit()
    return s


async def resume(db: AsyncSession, s: PomodoroSession) -> PomodoroSession:
    _require(s, SessionStatus.paused)
    if s.paused_at:
        s.paused_seconds += int((utcnow() - s.paused_at).total_seconds())
    s.paused_at = None
    s.status = SessionStatus.running
    await db.commit()
    return s


async def end(db: AsyncSession, s: PomodoroSession, final: SessionStatus, note: str | None) -> PomodoroSession:
    _require(s, *ACTIVE)
    now = utcnow()
    if s.status == SessionStatus.paused and s.paused_at:
        s.paused_seconds += int((now - s.paused_at).total_seconds())
        s.paused_at = None
    s.status = final
    s.ended_at = now
    if note is not None:
        s.note = note
    await db.commit()
    return s


async def add_distraction(db: AsyncSession, s: PomodoroSession) -> DistractionEvent:
    _require(s, *ACTIVE)
    now = utcnow()
    # 2 秒去抖：手抖连点只记一次
    q = (
        select(DistractionEvent)
        .where(DistractionEvent.session_id == s.id, DistractionEvent.occurred_at >= now - DEBOUNCE)
        .order_by(DistractionEvent.occurred_at.desc())
    )
    recent = (await db.execute(q)).scalars().first()
    if recent:
        return recent
    ev = DistractionEvent(
        session_id=s.id,
        user_id=s.user_id,
        occurred_at=now,
        offset_seconds=elapsed_seconds(s, now),
        source=DistractionSource.button,
    )
    s.distraction_count += 1
    db.add(ev)
    await db.commit()
    await db.refresh(ev)
    return ev
