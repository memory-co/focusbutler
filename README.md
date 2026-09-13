# FocusButler · 注意力管家

自托管的番茄钟。注册账号后即可开始番茄计时，和普通番茄钟的区别是每个番茄都会记录"你有没有走神"：

- **摄像头记录**：番茄进行期间浏览器持续录制视频并分片上传到你自己的服务器，事后可回看。
- **走神按钮**：页面上一个很大的按钮（或空格键），走神时按一下，记录发生在番茄的第几秒。

两项都是每个番茄默认开启的，没有模式选择。摄像头不可用或被拒绝授权时番茄照常进行，只是这次没有视频。

## 技术栈

| 层 | 选型 |
|---|---|
| 后端 | Python 3.11+ · FastAPI · SQLAlchemy 2 (async) · aiomysql |
| 数据库 | MySQL 5.6（阿里云 RDS），视频二进制放本地文件系统 |
| 认证 | 用户名密码 · bcrypt · JWT（HttpOnly Cookie） |
| 前端 | Vite · React 18 · TypeScript · Tailwind · shadcn/ui · zustand · react-query |
| 摄像头 | `getUserMedia` + `MediaRecorder`，WebM 分片上传 |

## 快速开始

```bash
# 后端
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
cp .env.example .env          # 填 MySQL 连接信息和 JWT 密钥
# 前端
cd frontend && npm install && npm run build && cd ..
# 启动（首次启动自动建表）
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

打开 `http://localhost:8000`。接口文档在 `/docs`。

前端开发时用 `cd frontend && npm run dev`，Vite 会把 `/api` 代理到 8000 端口。

## 结构

```
app/                FastAPI 后端
  routers/          auth · sessions · distractions · video · stats
  services/         番茄会话状态机、走神去抖
  models.py         ORM：users / pomodoro_sessions / distraction_events / video_chunks
frontend/src/
  lib/              api 客户端、zustand store、hash 路由、录制器
  pages/            登录 · 今日 · 专注 · 历史 · 设置
  components/ui/    shadcn 组件
data/videos/        视频分片 {user_id}/{session_id}/{seq}.webm（不进 git）
```

## 几个设计决定

- **计时以服务端为准**。会话记录 `started_at` 和累计暂停秒数，前端只做插值，切回标签页会重新校准，后台标签页不会漂移。
- **走神按钮先本地计数再发请求**，失败进 localStorage 队列稍后重试；服务端对同一会话 2 秒内的重复请求去抖。
- **视频分片顺序拼接即可播放**。`MediaRecorder` 切出的分片只有第一片带文件头，所以回放接口把分片按序拼成一个流返回，不做转码。
- **全库 UTC**。MySQL `DATETIME(3)` 不带时区，统一存 UTC，统计接口接收 `tz_offset` 按本地日期分组。
- **MySQL 5.6 约束**：没有 JSON 列类型（用户设置存 TEXT），建表显式 utf8mb4。
- **跨用户访问一律 404**，不返回 403，避免枚举。

## 路线

- [x] 注册登录、番茄会话、走神按钮、摄像头分片录制、历史回放、统计
- [ ] Alembic 迁移（目前靠启动时 `create_all`）
- [ ] 视频自动走神检测（事件表已预留 `source=auto`）

## License

见 [LICENSE](LICENSE)。
