import json
import shutil
import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    clear_auth_cookie,
    create_token,
    get_current_user,
    hash_password,
    set_auth_cookie,
    user_out,
    user_settings,
    verify_password,
)
from app.config import settings
from app.db import get_db
from app.models import User
from app.schemas import Credentials, UserOut, UserSettings, UserSettingsPatch

router = APIRouter(prefix="/api/auth", tags=["auth"])

# 注册接口按 IP 限速，进程内实现，单实例够用
_register_hits: dict[str, deque[float]] = defaultdict(deque)


def _check_register_rate(request: Request) -> None:
    ip = request.client.host if request.client else "?"
    now = time.monotonic()
    hits = _register_hits[ip]
    while hits and now - hits[0] > 60:
        hits.popleft()
    if len(hits) >= settings.register_rate_per_minute:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "注册太频繁，请稍后再试")
    hits.append(now)


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def register(body: Credentials, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    _check_register_rate(request)
    exists = (await db.execute(select(User.id).where(User.username == body.username))).first()
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, "用户名已存在")
    user = User(
        username=body.username,
        password_hash=hash_password(body.password),
        settings_json=UserSettings().model_dump_json(),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    set_auth_cookie(response, create_token(user.id))
    return user_out(user)


@router.post("/login", response_model=UserOut)
async def login(body: Credentials, response: Response, db: AsyncSession = Depends(get_db)):
    user = (await db.execute(select(User).where(User.username == body.username))).scalars().first()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "用户名或密码错误")
    set_auth_cookie(response, create_token(user.id))
    return user_out(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response):
    clear_auth_cookie(response)


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return user_out(user)


@router.patch("/me/settings", response_model=UserOut)
async def patch_settings(
    body: UserSettingsPatch, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    merged = user_settings(user).model_dump() | body.model_dump(exclude_none=True)
    user.settings_json = json.dumps(UserSettings.model_validate(merged).model_dump())
    await db.commit()
    return user_out(user)


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_me(response: Response, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """删除账号：级联删除所有会话、事件、分片记录，并清掉视频文件。"""
    await db.delete(user)
    await db.commit()
    shutil.rmtree(settings.video_dir / user.id, ignore_errors=True)
    clear_auth_cookie(response)
