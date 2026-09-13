"""把 MediaRecorder 的分片合成一个带时长和索引的 WebM，播放器才能跳转。

浏览器录出来的 WebM 没有 Duration 和 Cues，直接拼起来播放器只能从头放。
用 ffmpeg 只换容器不重新编码（-c copy），25 分钟视频一两秒完成。
"""

import asyncio
import logging
import shutil
from collections import defaultdict
from pathlib import Path

import aiofiles
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import VideoChunk

log = logging.getLogger(__name__)
MERGED_NAME = "full.webm"
_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def merged_path(user_id: str, session_id: str) -> Path:
    return settings.video_dir / user_id / session_id / MERGED_NAME


async def chunk_paths(db: AsyncSession, session_id: str) -> list[Path]:
    q = select(VideoChunk).where(VideoChunk.session_id == session_id).order_by(VideoChunk.seq)
    chunks = (await db.execute(q)).scalars().all()
    return [settings.video_dir / c.path for c in chunks if (settings.video_dir / c.path).exists()]


async def build_merged(user_id: str, session_id: str, paths: list[Path]) -> Path | None:
    """分片顺序喂给 ffmpeg stdin，输出 full.webm。已存在则直接返回。失败返回 None。"""
    out = merged_path(user_id, session_id)
    if out.exists():
        return out
    if not paths or not ffmpeg_available():
        return None
    async with _locks[session_id]:
        if out.exists():
            return out
        tmp = out.with_suffix(".tmp.webm")
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-fflags", "+genpts", "-i", "pipe:0", "-c", "copy", str(tmp),
            stdin=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        assert proc.stdin
        try:
            for p in paths:
                async with aiofiles.open(p, "rb") as f:
                    while data := await f.read(1024 * 1024):
                        proc.stdin.write(data)
                        await proc.stdin.drain()
            proc.stdin.close()
            _, err = await proc.communicate()
        except (BrokenPipeError, ConnectionResetError):
            _, err = await proc.communicate()
        if proc.returncode != 0 or not tmp.exists() or tmp.stat().st_size == 0:
            log.warning("ffmpeg merge failed for session %s: %s", session_id, err.decode(errors="replace")[-500:])
            tmp.unlink(missing_ok=True)
            return None
        tmp.replace(out)
        return out


async def build_merged_for_session(user_id: str, session_id: str) -> None:
    """后台任务入口：自己开一个数据库会话查分片。"""
    from app.db import SessionLocal

    try:
        async with SessionLocal() as db:
            paths = await chunk_paths(db, session_id)
        await build_merged(user_id, session_id, paths)
    except Exception:
        log.exception("background merge failed for session %s", session_id)
