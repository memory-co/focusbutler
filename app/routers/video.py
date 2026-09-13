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
from app.services import video_service

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
    """回放整段视频。

    优先返回 ffmpeg 合成的 full.webm（带时长和索引，FileResponse 支持 Range，播放器可以跳转）。
    老会话没有合成文件就现场合成一次；ffmpeg 不可用时退回把分片按序拼成一个流，
    这种流只能从头播、不能跳转。
    """
    await svc.get_owned(db, user, session_id)
    paths = await video_service.chunk_paths(db, session_id)
    if not paths:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "该会话没有视频")

    merged = await video_service.build_merged(user.id, session_id, paths)
    if merged:
        return FileResponse(merged, media_type="video/webm", headers={"Cache-Control": "private, max-age=3600"})

    total = sum(p.stat().st_size for p in paths)

    async def body() -> AsyncIterator[bytes]:
        for p in paths:
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
