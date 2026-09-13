from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_db
from app.models import DistractionEvent, PomodoroSession, SessionStatus, User, utcnow
from app.schemas import DailyStat, HeatmapBucket, StatsSummary

router = APIRouter(prefix="/api/stats", tags=["stats"])

# 实际专注秒数 = 结束 - 开始 - 暂停
_focus_seconds = func.timestampdiff(text("SECOND"), PomodoroSession.started_at, PomodoroSession.ended_at) - PomodoroSession.paused_seconds


def _since(days: int, tz_offset: int):
    """从"本地今天零点"往前推 days-1 天，换算成 UTC。"""
    local_now = utcnow() + timedelta(minutes=tz_offset)
    local_start = local_now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days - 1)
    return local_start - timedelta(minutes=tz_offset)


@router.get("/summary", response_model=StatsSummary)
async def summary(
    days: int = Query(7, ge=1, le=365),
    tz_offset: int = Query(0, ge=-840, le=840, description="本地时区相对 UTC 的分钟数，东八区为 480"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    since = _since(days, tz_offset)
    completed = PomodoroSession.status == SessionStatus.completed
    q = select(
        func.sum(case((completed, 1), else_=0)),
        func.sum(case((PomodoroSession.status == SessionStatus.abandoned, 1), else_=0)),
        func.sum(case((completed, _focus_seconds), else_=0)),
        func.sum(PomodoroSession.distraction_count),
    ).where(PomodoroSession.user_id == user.id, PomodoroSession.started_at >= since)
    c, a, secs, d = (await db.execute(q)).one()
    c, a, secs, d = int(c or 0), int(a or 0), int(secs or 0), int(d or 0)
    return StatsSummary(
        days=days,
        completed_sessions=c,
        abandoned_sessions=a,
        focus_minutes=secs // 60,
        distractions=d,
        distractions_per_session=round(d / c, 2) if c else 0.0,
    )


@router.get("/daily", response_model=list[DailyStat])
async def daily(
    days: int = Query(30, ge=1, le=365),
    tz_offset: int = Query(0, ge=-840, le=840),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    since = _since(days, tz_offset)
    local_date = func.date(func.date_add(PomodoroSession.started_at, text(f"INTERVAL {tz_offset} MINUTE")))
    completed = PomodoroSession.status == SessionStatus.completed
    q = (
        select(
            local_date.label("d"),
            func.sum(case((completed, 1), else_=0)),
            func.sum(case((completed, _focus_seconds), else_=0)),
            func.sum(PomodoroSession.distraction_count),
        )
        .where(PomodoroSession.user_id == user.id, PomodoroSession.started_at >= since)
        .group_by("d")
        .order_by("d")
    )
    rows = (await db.execute(q)).all()
    by_date = {str(d): (int(c or 0), int(secs or 0) // 60, int(dis or 0)) for d, c, secs, dis in rows}
    # 补齐没有数据的日期，前端画图不用自己填零
    start_local = (since + timedelta(minutes=tz_offset)).date()
    out = []
    for i in range(days):
        d = str(start_local + timedelta(days=i))
        c, m, dis = by_date.get(d, (0, 0, 0))
        out.append(DailyStat(date=d, completed_sessions=c, focus_minutes=m, distractions=dis))
    return out


@router.get("/distraction-heatmap", response_model=list[HeatmapBucket])
async def distraction_heatmap(
    days: int = Query(30, ge=1, le=365),
    tz_offset: int = Query(0, ge=-840, le=840),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """走神发生在番茄第几分钟：按分钟桶统计。"""
    since = _since(days, tz_offset)
    minute = func.floor(DistractionEvent.offset_seconds / 60)
    q = (
        select(minute.label("m"), func.count())
        .where(DistractionEvent.user_id == user.id, DistractionEvent.occurred_at >= since)
        .group_by("m")
        .order_by("m")
    )
    rows = (await db.execute(q)).all()
    return [HeatmapBucket(minute=int(m), count=int(c)) for m, c in rows]
