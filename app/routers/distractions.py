from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_db
from app.models import DistractionEvent, PomodoroSession, User
from app.schemas import DistractionOut
from app.services import session_service as svc

router = APIRouter(prefix="/api", tags=["distractions"])


@router.post("/sessions/{session_id}/distractions", response_model=DistractionOut, status_code=status.HTTP_201_CREATED)
async def add_distraction(session_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    s = await svc.get_owned(db, user, session_id)
    return await svc.add_distraction(db, s)


@router.get("/sessions/{session_id}/distractions", response_model=list[DistractionOut])
async def list_distractions(session_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await svc.get_owned(db, user, session_id)
    q = (
        select(DistractionEvent)
        .where(DistractionEvent.session_id == session_id)
        .order_by(DistractionEvent.offset_seconds)
    )
    return (await db.execute(q)).scalars().all()


@router.delete("/distractions/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_distraction(event_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """误按撤销。"""
    ev = await db.get(DistractionEvent, event_id)
    if ev is None or ev.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "事件不存在")
    s = await db.get(PomodoroSession, ev.session_id)
    if s and s.distraction_count > 0:
        s.distraction_count -= 1
    await db.delete(ev)
    await db.commit()
