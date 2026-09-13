from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

engine = create_async_engine(settings.db_url, pool_pre_ping=True, pool_recycle=1800, echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as db:
        yield db


async def init_db() -> None:
    from app import models  # noqa: F401  确保表已注册

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
