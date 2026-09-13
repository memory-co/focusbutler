import shutil
from datetime import datetime

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import get_current_user, user_settings
from app.config import settings
from app.db import get_db
from app.models import PomodoroSession, SessionStatus, User
from app.schemas import SessionCreate, SessionDetail, SessionEnd, SessionOut, SessionPage
from app.services import session_service as svc

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.post("", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
async def create_session(body: SessionCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    planned = body.planned_seconds or user_settings(user).focus_minutes * 60
    s = await svc.create(db, user, body.camera_status, planned)
    return svc.to_out(s)


@router.get("/current", response_model=SessionOut | None)
async def current_session(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    s = await svc.get_active(db, user.id)
    if s is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    return svc.to_out(s)


@router.get("", response_model=SessionPage)
async def list_sessions(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    from_: datetime | None = Query(None, alias="from"),
    to: datetime | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    cond = [PomodoroSession.user_id == user.id]
    if from_:
        cond.append(PomodoroSession.started_at >= from_)
    if to:
        cond.append(PomodoroSession.started_at < to)
    total = (await db.execute(select(func.count()).select_from(PomodoroSession).where(*cond))).scalar_one()
    q = (
        select(PomodoroSession)
        .where(*cond)
        .order_by(PomodoroSession.started_at.desc())
        .offset((page - 1) * size)
        .limit(size)
    )
    items = (await db.execute(q)).scalars().all()
    now = svc.utcnow()
    return SessionPage(items=[svc.to_out(s, now) for s in items], page=page, size=size, total=total)


@router.get("/{session_id}", response_model=SessionDetail)
async def get_session(session_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await svc.get_owned(db, user, session_id)
    q = (
        select(PomodoroSession)
        .where(PomodoroSession.id == session_id)
        .options(selectinload(PomodoroSession.distractions), selectinload(PomodoroSession.chunks))
    )
    s = (await db.execute(q)).scalar_one()
    return svc.to_detail(s)


@router.post("/{session_id}/pause", response_model=SessionOut)
async def pause_session(session_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return svc.to_out(await svc.pause(db, await svc.get_owned(db, user, session_id)))


@router.post("/{session_id}/resume", response_model=SessionOut)
async def resume_session(session_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return svc.to_out(await svc.resume(db, await svc.get_owned(db, user, session_id)))


@router.post("/{session_id}/complete", response_model=SessionOut)
async def complete_session(
    session_id: str, body: SessionEnd | None = None, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    s = await svc.get_owned(db, user, session_id)
    return svc.to_out(await svc.end(db, s, SessionStatus.completed, body.note if body else None))


@router.post("/{session_id}/abandon", response_model=SessionOut)
async def abandon_session(
    session_id: str, body: SessionEnd | None = None, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    s = await svc.get_owned(db, user, session_id)
    return svc.to_out(await svc.end(db, s, SessionStatus.abandoned, body.note if body else None))


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(session_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    s = await svc.get_owned(db, user, session_id)
    await db.delete(s)
    await db.commit()
    shutil.rmtree(settings.video_dir / user.id / session_id, ignore_errors=True)
