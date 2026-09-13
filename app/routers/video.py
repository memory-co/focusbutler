from collections.abc import AsyncIterator
from pathlib import Path

import aiofiles
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.config import settings
from app.db import get_db
from app.models import User, VideoChunk
from app.schemas import VideoChunkOut
from app.services import session_service as svc

router = APIRouter(prefix="/api", tags=["video"])


def _chunk_path(user_id: str, session_id: str, seq: int) -> Path:
    return settings.video_dir / user_id / session_id / f"{seq:05d}.webm"


@router.post("/sessions/{session_id}/video/chunks", response_model=VideoChunkOut, status_code=status.HTTP_201_CREATED)
async def upload_chunk(
    session_id: str,
    seq: int = Form(ge=0),
    offset_seconds: int = Form(ge=0),
    duration_seconds: float = Form(ge=0),
    file: UploadFile = File(),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    s = await svc.get_owned(db, user, session_id)
    if s.status not in svc.ACTIVE:
        raise HTTPException(status.HTTP_409_CONFLICT, "会话已结束，不再接收视频")

    limit = settings.max_chunk_mb * 1024 * 1024
    path = _chunk_path(user.id, session_id, seq)
    path.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    async with aiofiles.open(path, "wb") as out:
        while data := await file.read(1024 * 1024):
            size += len(data)
            if size > limit:
                await out.close()
                path.unlink(missing_ok=True)
                raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"分片超过 {settings.max_chunk_mb} MB")
            await out.write(data)

    # seq 重复则幂等覆盖
    q = select(VideoChunk).where(VideoChunk.session_id == session_id, VideoChunk.seq == seq)
    chunk = (await db.execute(q)).scalars().first()
    if chunk is None:
        chunk = VideoChunk(session_id=session_id, user_id=user.id, seq=seq)
        db.add(chunk)
    chunk.offset_seconds = offset_seconds
    chunk.duration_seconds = duration_seconds
    chunk.path = str(path.relative_to(settings.video_dir))
    chunk.size_bytes = size
    chunk.mime_type = (file.content_type or "video/webm")[:64]
    await db.commit()
    await db.refresh(chunk)
    return chunk


@router.get("/sessions/{session_id}/video/chunks", response_model=list[VideoChunkOut])
async def list_chunks(session_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await svc.get_owned(db, user, session_id)
    q = select(VideoChunk).where(VideoChunk.session_id == session_id).order_by(VideoChunk.seq)
    return (await db.execute(q)).scalars().all()


@router.get("/sessions/{session_id}/video")
async def stream_video(session_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """把所有分片按 seq 顺序拼成一个 WebM 流。

    MediaRecorder 用 timeslice 切出来的分片只有第一片带文件头，单独不能播，
    但按顺序拼接就是一个完整的 WebM，所以回放走这一个接口。
    """
    await svc.get_owned(db, user, session_id)
    q = select(VideoChunk).where(VideoChunk.session_id == session_id).order_by(VideoChunk.seq)
    chunks = (await db.execute(q)).scalars().all()
    if not chunks:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "该会话没有视频")

    paths = [settings.video_dir / c.path for c in chunks]
    total = sum(p.stat().st_size for p in paths if p.exists())

    async def body() -> AsyncIterator[bytes]:
        for p in paths:
            if not p.exists():
                continue
            async with aiofiles.open(p, "rb") as f:
                while data := await f.read(256 * 1024):
                    yield data

    return StreamingResponse(body(), media_type="video/webm", headers={"Content-Length": str(total)})


@router.get("/video/chunks/{chunk_id}")
async def download_chunk(chunk_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    chunk = await db.get(VideoChunk, chunk_id)
    if chunk is None or chunk.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "分片不存在")
    path = settings.video_dir / chunk.path
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "分片文件丢失")
    return FileResponse(path, media_type=chunk.mime_type, filename=path.name)
