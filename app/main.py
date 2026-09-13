from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.db import engine, init_db
from app.routers import auth, distractions, sessions, stats, video

FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.video_dir.mkdir(parents=True, exist_ok=True)
    await init_db()
    yield
    await engine.dispose()


app = FastAPI(title="FocusButler", version="0.1.0", lifespan=lifespan)

for r in (auth, sessions, distractions, video, stats):
    app.include_router(r.router)


def mount_frontend(app: FastAPI, root: Path = FRONTEND_DIST) -> None:
    """托管 Vite 构建产物。页面用 hash 路由，所以只需要 / 和 /assets。"""
    if not (root / "index.html").is_file():
        return

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(root / "index.html", headers={"Cache-Control": "no-cache"})

    if (root / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=root / "assets"), name="frontend-assets")


mount_frontend(app)
