# FocusButler · 注意力管家

一个自托管的番茄钟小工具。注册账号后即可开始番茄计时，和普通番茄钟的区别在于它会记录"你有没有走神"：

- **摄像头模式**：番茄进行期间，浏览器调用摄像头持续录制视频数据并上传到后端，供事后回看或后续做注意力分析。
- **走神按钮模式**：页面上有一个很大的按钮，走神的时候按一下，系统记录一次走神事件及其发生时刻。

两种模式可单独使用，也可以同时开启。

---

## 1. 目标与非目标

**目标**

- 多用户：支持自助注册、登录，数据按用户隔离。
- 番茄计时：可配置专注/休息时长，支持开始、暂停、放弃、完成。
- 走神记录：按钮事件、视频片段两类数据都挂在一次番茄会话下。
- 存储可替换：第一阶段用本地 JSON 文件，第二阶段无改动业务代码切到 MySQL。
- 前后端同仓库：FastAPI 直接托管静态前端，一条命令启动。

**非目标（当前阶段）**

- 不做视频内容的自动分析（人脸/视线检测），只负责采集和保存，留好扩展点。
- 不做团队/多人协作，不做 OAuth 第三方登录。
- 不做移动端原生 App，浏览器访问即可。

---

## 2. 技术选型

| 层 | 选型 | 说明 |
|---|---|---|
| 后端 | Python 3.11+ / FastAPI / Uvicorn | 异步、自带 OpenAPI 文档 |
| 认证 | 用户名 + 密码，`bcrypt` 哈希，JWT（HttpOnly Cookie） | 无需引入 session 中间件 |
| 数据校验 | Pydantic v2 | 请求/响应模型，也是 JSON 存储的序列化格式 |
| 存储 v1 | 本地 JSON 文件（`data/*.json`） | 单进程，文件锁保证写入安全 |
| 存储 v2 | MySQL 8 + SQLAlchemy 2 (async) + Alembic | 通过 Repository 接口切换 |
| 视频存储 | 本地文件系统（`data/videos/`） | 元数据进数据库，二进制不进数据库 |
| 前端 | 原生 HTML + CSS + JavaScript（无构建步骤） | 由 FastAPI `StaticFiles` 托管 |
| 摄像头 | `navigator.mediaDevices.getUserMedia` + `MediaRecorder` | WebM 分片上传 |

不引入前端框架的原因：页面总共只有四五个，交互以计时器和一个大按钮为主，原生 JS 足够，也省掉 Node 工具链。

---

## 3. 整体架构

```mermaid
flowchart LR
    subgraph Browser[浏览器]
        UI[页面：登录/仪表盘/计时/历史]
        Timer[计时器状态机]
        Rec[MediaRecorder 分片录制]
        Btn[走神大按钮]
    end

    subgraph API[FastAPI]
        Auth[/auth 注册·登录/]
        Sess[/sessions 番茄会话/]
        Dist[/distractions 走神事件/]
        Video[/video 分片上传/]
        Stats[/stats 统计/]
        Static[StaticFiles 前端]
    end

    subgraph Storage[存储层 Repository 接口]
        JSONRepo[JSON 文件实现 v1]
        MySQLRepo[MySQL 实现 v2]
        FS[(data/videos/ 视频文件)]
    end

    UI --> Static
    Timer --> Sess
    Btn --> Dist
    Rec --> Video
    Auth & Sess & Dist & Video & Stats --> JSONRepo
    Auth & Sess & Dist & Video & Stats -.切换.-> MySQLRepo
    Video --> FS
```

关键原则：**业务层只依赖 Repository 接口，不依赖具体存储**。切换存储只改一个环境变量。

---

## 4. 数据模型

所有实体都有 `id`（UUID 字符串）、`created_at`（UTC ISO 时间）。UUID 而不是自增 ID，是为了 JSON 阶段生成的数据能原样导入 MySQL。

### 4.1 User 用户

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | |
| username | str，唯一 | 3-32 位，字母数字下划线 |
| password_hash | str | bcrypt |
| settings | json | 见下方默认值 |
| created_at | datetime | |

`settings` 默认值：

```json
{
  "focus_minutes": 25,
  "short_break_minutes": 5,
  "long_break_minutes": 15,
  "long_break_every": 4,
  "default_mode": "button",
  "video_chunk_seconds": 10
}
```

### 4.2 PomodoroSession 番茄会话

一次番茄 = 一条会话。休息时间不建会话，只在前端倒计时。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | |
| user_id | uuid | |
| mode | enum: `button` / `camera` / `both` | 本次会话开启的记录方式 |
| planned_seconds | int | 计划专注时长 |
| started_at | datetime | |
| ended_at | datetime，可空 | 结束（完成或放弃）时间 |
| status | enum: `running` / `paused` / `completed` / `abandoned` | |
| paused_seconds | int | 累计暂停时长，用于算实际专注时长 |
| note | str，可空 | 用户结束时填的备注 |
| distraction_count | int | 冗余字段，方便列表页展示 |

### 4.3 DistractionEvent 走神事件

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | |
| session_id | uuid | |
| user_id | uuid | 冗余，方便按用户查 |
| occurred_at | datetime | 按下按钮的服务器时间 |
| offset_seconds | int | 距会话开始的秒数（去掉暂停） |
| source | enum: `button` / `auto` | `auto` 预留给未来视频分析 |

### 4.4 VideoChunk 视频分片

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | |
| session_id | uuid | |
| user_id | uuid | |
| seq | int | 分片序号，从 0 开始 |
| offset_seconds | int | 分片起点距会话开始的秒数 |
| duration_seconds | float | |
| path | str | 相对 `data/videos/` 的路径 |
| size_bytes | int | |
| mime_type | str | 如 `video/webm;codecs=vp9` |

文件路径规则：`data/videos/{user_id}/{session_id}/{seq:05d}.webm`

---

## 5. API 设计

全部以 `/api` 为前缀，JSON 请求/响应。认证通过 HttpOnly Cookie `fb_token`（JWT，7 天有效）。

### 5.1 认证

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | `{username, password}` → 创建用户并直接登录 |
| POST | `/api/auth/login` | `{username, password}` → 设置 Cookie |
| POST | `/api/auth/logout` | 清除 Cookie |
| GET | `/api/auth/me` | 当前用户信息 + settings |
| PATCH | `/api/auth/me/settings` | 部分更新 settings |

密码规则：至少 8 位。注册失败返回 409（用户名已存在）或 422（格式不合法）。

### 5.2 番茄会话

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/sessions` | `{mode, planned_seconds?}` → 创建并开始，返回会话 |
| GET | `/api/sessions/current` | 当前 running/paused 的会话，没有返回 204 |
| GET | `/api/sessions` | 分页列表，`?page=&size=&from=&to=` |
| GET | `/api/sessions/{id}` | 详情，含走神事件列表与分片列表 |
| POST | `/api/sessions/{id}/pause` | |
| POST | `/api/sessions/{id}/resume` | |
| POST | `/api/sessions/{id}/complete` | `{note?}`，正常结束 |
| POST | `/api/sessions/{id}/abandon` | `{note?}`，放弃 |
| DELETE | `/api/sessions/{id}` | 删除会话及其事件、视频文件 |

同一用户同一时间只允许一个 running/paused 会话，重复创建返回 409。

### 5.3 走神事件

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/sessions/{id}/distractions` | 记录一次走神，body 可空；`offset_seconds` 由服务端根据会话时间计算 |
| GET | `/api/sessions/{id}/distractions` | 列表 |
| DELETE | `/api/distractions/{id}` | 误按撤销 |

服务端做 2 秒去抖：同一会话 2 秒内的重复请求返回已有事件而不新建。

### 5.4 视频分片

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/sessions/{id}/video/chunks` | `multipart/form-data`：`seq`、`offset_seconds`、`duration_seconds`、`file` |
| GET | `/api/sessions/{id}/video/chunks` | 分片元数据列表 |
| GET | `/api/video/chunks/{chunk_id}` | 下载单个分片（校验归属） |
| GET | `/api/sessions/{id}/video/playlist` | 按 seq 顺序返回分片 URL 列表，前端顺序播放 |

上传限制：单分片 ≤ 20 MB，会话状态必须是 running/paused，`seq` 重复则幂等覆盖。

### 5.5 统计

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/stats/summary?days=7` | 完成番茄数、总专注分钟、走神总次数、平均每番茄走神次数 |
| GET | `/api/stats/daily?days=30` | 按天聚合，用于画图 |
| GET | `/api/stats/distraction-heatmap` | 走神发生在番茄第几分钟的分布（0-24 分钟桶） |

---

## 6. 前端页面

| 路径 | 页面 | 内容 |
|---|---|---|
| `/` | 仪表盘 | 今日概览、开始按钮、模式选择（按钮 / 摄像头 / 两者） |
| `/login` | 登录/注册 | 一个页面两个 Tab |
| `/focus` | 计时页 | 核心页面，见下 |
| `/history` | 历史 | 会话列表，点开看走神时间轴、视频回放 |
| `/settings` | 设置 | 时长、默认模式、分片长度 |

### 6.1 计时页 `/focus`

```
┌──────────────────────────────────────────────┐
│  ● 录制中  ·  第 3 个番茄            [设置]  │
│                                              │
│                  18:42                       │
│            ━━━━━━━━━━━━━━━━░░░░░              │
│                                              │
│   ┌──────────────────────────────────────┐   │
│   │                                      │   │
│   │            我 走 神 了                │   │
│   │                                      │   │
│   │          本次已走神 2 次              │   │
│   └──────────────────────────────────────┘   │
│                                              │
│      [暂停]        [放弃]        [撤销上次]   │
│                                              │
│  摄像头模式：右下角小窗预览，可折叠            │
└──────────────────────────────────────────────┘
```

设计要点：

- 大按钮占据视口宽度 80% 以上，高度不小于 200px，触摸/鼠标/空格键都能触发，按下有明显动画和震动反馈（移动端 `navigator.vibrate`）。
- 按钮点击后**先本地记录再发请求**，网络失败放入队列重试，保证不丢事件。
- 计时以服务端 `started_at` + `paused_seconds` 为准，前端每次可见性变化（切回标签页）都重新校准，避免后台标签页计时漂移。
- 番茄结束时浏览器通知 + 声音，然后自动进入休息倒计时（纯前端）。

### 6.2 摄像头录制流程

```mermaid
sequenceDiagram
    participant U as 用户
    participant B as 浏览器
    participant S as 后端

    U->>B: 选择摄像头模式，点击开始
    B->>B: getUserMedia({video:true, audio:false})
    B->>S: POST /api/sessions {mode:"camera"}
    S-->>B: session
    B->>B: MediaRecorder.start(chunk_seconds*1000)
    loop 每个分片
        B->>B: ondataavailable → Blob
        B->>S: POST /sessions/{id}/video/chunks (seq, offset, file)
        S->>S: 写 data/videos/{user}/{session}/{seq}.webm
        S-->>B: 200
    end
    U->>B: 完成 / 放弃
    B->>B: MediaRecorder.stop()，上传最后一片
    B->>S: POST /sessions/{id}/complete
```

- 分辨率默认 640×480、15 fps，`videoBitsPerSecond` 约 400 kbps，一个 25 分钟番茄约 75 MB。
- 分片上传失败进入本地 IndexedDB 队列，会话结束前重试；页面关闭时用 `sendBeacon` 尽力上传最后一片。
- 首次使用弹出隐私说明：视频只保存在自己部署的服务器上，不做上传到第三方。

---

## 7. 存储层设计

### 7.1 Repository 接口

```python
class UserRepo(Protocol):
    async def create(self, user: User) -> User: ...
    async def get_by_id(self, id: str) -> User | None: ...
    async def get_by_username(self, username: str) -> User | None: ...
    async def update_settings(self, id: str, settings: dict) -> User: ...

class SessionRepo(Protocol):
    async def create(self, s: PomodoroSession) -> PomodoroSession: ...
    async def get(self, id: str) -> PomodoroSession | None: ...
    async def get_active(self, user_id: str) -> PomodoroSession | None: ...
    async def list(self, user_id: str, page: int, size: int, ...) -> list[PomodoroSession]: ...
    async def update(self, s: PomodoroSession) -> PomodoroSession: ...
    async def delete(self, id: str) -> None: ...

class DistractionRepo(Protocol): ...
class VideoChunkRepo(Protocol): ...
```

通过 `get_repos()` 依赖注入，由环境变量 `FB_STORAGE=json|mysql` 决定实现。

### 7.2 v1：JSON 文件

```
data/
├── users.json          # {"users": [ {...}, ... ]}
├── sessions.json       # {"sessions": [ ... ]}
├── distractions.json   # {"distractions": [ ... ]}
├── video_chunks.json   # {"video_chunks": [ ... ]}
└── videos/
    └── {user_id}/{session_id}/00000.webm
```

- 每个文件一个 `asyncio.Lock`，写入先写临时文件再 `os.replace`，避免写一半崩溃损坏数据。
- 启动时全量加载到内存，读走内存，写同步落盘。数据量在个人使用范围内（几千条会话）完全够用。
- 提供 `scripts/export_json.py` 把 JSON 导出成 MySQL 可导入的格式，用于迁移。

### 7.3 v2：MySQL

```sql
CREATE TABLE users (
  id            CHAR(36) PRIMARY KEY,
  username      VARCHAR(32) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  settings      JSON NOT NULL,
  created_at    DATETIME(3) NOT NULL
);

CREATE TABLE pomodoro_sessions (
  id                CHAR(36) PRIMARY KEY,
  user_id           CHAR(36) NOT NULL,
  mode              ENUM('button','camera','both') NOT NULL,
  planned_seconds   INT NOT NULL,
  started_at        DATETIME(3) NOT NULL,
  ended_at          DATETIME(3) NULL,
  status            ENUM('running','paused','completed','abandoned') NOT NULL,
  paused_seconds    INT NOT NULL DEFAULT 0,
  note              TEXT NULL,
  distraction_count INT NOT NULL DEFAULT 0,
  created_at        DATETIME(3) NOT NULL,
  INDEX idx_user_started (user_id, started_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE distraction_events (
  id             CHAR(36) PRIMARY KEY,
  session_id     CHAR(36) NOT NULL,
  user_id        CHAR(36) NOT NULL,
  occurred_at    DATETIME(3) NOT NULL,
  offset_seconds INT NOT NULL,
  source         ENUM('button','auto') NOT NULL DEFAULT 'button',
  created_at     DATETIME(3) NOT NULL,
  INDEX idx_session (session_id),
  INDEX idx_user_occurred (user_id, occurred_at),
  FOREIGN KEY (session_id) REFERENCES pomodoro_sessions(id) ON DELETE CASCADE
);

CREATE TABLE video_chunks (
  id               CHAR(36) PRIMARY KEY,
  session_id       CHAR(36) NOT NULL,
  user_id          CHAR(36) NOT NULL,
  seq              INT NOT NULL,
  offset_seconds   INT NOT NULL,
  duration_seconds FLOAT NOT NULL,
  path             VARCHAR(255) NOT NULL,
  size_bytes       BIGINT NOT NULL,
  mime_type        VARCHAR(64) NOT NULL,
  created_at       DATETIME(3) NOT NULL,
  UNIQUE KEY uk_session_seq (session_id, seq),
  FOREIGN KEY (session_id) REFERENCES pomodoro_sessions(id) ON DELETE CASCADE
);
```

视频二进制仍然放文件系统，MySQL 只存元数据。

---

## 8. 项目结构

```
focusbutler/
├── README.md
├── pyproject.toml
├── .env.example
├── app/
│   ├── main.py              # FastAPI 实例、路由挂载、静态文件
│   ├── config.py            # 环境变量（存储类型、JWT 密钥、数据目录）
│   ├── auth.py              # 密码哈希、JWT、当前用户依赖
│   ├── models.py            # Pydantic 领域模型
│   ├── schemas.py           # 请求/响应模型
│   ├── routers/
│   │   ├── auth.py
│   │   ├── sessions.py
│   │   ├── distractions.py
│   │   ├── video.py
│   │   └── stats.py
│   ├── services/
│   │   ├── session_service.py   # 状态机、去抖、offset 计算
│   │   └── stats_service.py
│   └── storage/
│       ├── base.py          # Repository Protocol
│       ├── json_repo.py     # v1
│       ├── mysql_repo.py    # v2
│       └── factory.py       # get_repos()
├── static/
│   ├── index.html  login.html  focus.html  history.html  settings.html
│   ├── css/app.css
│   └── js/
│       ├── api.js           # fetch 封装
│       ├── timer.js         # 计时状态机
│       ├── recorder.js      # MediaRecorder + 上传队列
│       └── distraction.js   # 大按钮逻辑 + 离线队列
├── data/                    # 运行时生成，.gitignore
├── scripts/
│   └── export_json.py
└── tests/
    ├── test_auth.py
    ├── test_sessions.py
    └── test_json_repo.py
```

---

## 9. 配置

`.env.example`：

```
FB_STORAGE=json                 # json | mysql
FB_DATA_DIR=./data
FB_JWT_SECRET=change-me
FB_JWT_EXPIRE_DAYS=7
FB_MAX_CHUNK_MB=20
FB_MYSQL_DSN=mysql+aiomysql://user:pass@localhost:3306/focusbutler
```

启动：

```bash
pip install -e .
uvicorn app.main:app --reload
# 打开 http://127.0.0.1:8000
```

---

## 10. 安全与隐私

- 密码 bcrypt 哈希，JWT 放 HttpOnly + SameSite=Lax Cookie，前端拿不到 token。
- 所有会话/事件/分片接口都校验 `user_id` 归属，跨用户访问返回 404 而不是 403，避免枚举。
- 视频分片下载走后端接口鉴权，不直接暴露 `data/videos/` 为静态目录。
- 注册接口按 IP 限速（每分钟 5 次），防止刷号。
- 提供"删除账号"功能，级联删除所有数据和视频文件。

---

## 11. 开发路线

| 阶段 | 内容 |
|---|---|
| M1 | 注册/登录、JSON 存储、番茄会话状态机、走神按钮、计时页 |
| M2 | 摄像头录制、分片上传、历史页回放（走神时间轴 + 视频） |
| M3 | 统计接口与图表、设置页、离线队列、浏览器通知 |
| M4 | MySQL Repository、Alembic 迁移、JSON → MySQL 导入脚本 |
| M5（可选） | 视频自动走神检测（`source=auto`），与手动事件对比 |

---

## License

见 [LICENSE](LICENSE)。
