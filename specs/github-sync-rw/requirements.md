# Requirements: GitHub Sync RW (AWS 读写分离)

**版本**：v1.0
**日期**：2026-06-28
**状态**：Draft
**父 PRD**：`docs/PRD.md`（GitHub Profile Sync Manager v2.0）

> 本文档是 PRD v2.0 的「读写分离架构修订版」:在原有 GitHub Profile 同步功能基础上,引入 AWS RDS 主从架构,所有写操作走 Writer Endpoint,所有读操作走 Reader Endpoint。Schema 也相应调整为「按 `github_id` 索引的多 profile 模型」(`github_users` 表,无 user FK)。

---

## 1. 业务背景

已在 AWS 搭建好:
- VPC + NAT Gateway(让私有子网访问公网 GitHub API)
- RDS PostgreSQL **主从架构**(Writer + Reader Endpoint,同属一个 Cluster)
- 凭据:postgres / 密码(见 `.env`,已配置 `DATABASE_WRITER_URL` 与 `DATABASE_READER_URL`)

本 feature 在 `better-t-stack` monorepo 内实现同步逻辑,严格利用读写分离,让读密集操作(如频繁查看已同步资料)落到只读副本,降低主库压力。

## 2. 功能需求 (FR)

### FR-1: 环境变量支持双数据库连接

- 服务端 env schema 必须同时接受 `DATABASE_WRITER_URL` 与 `DATABASE_READER_URL`
- 旧的 `DATABASE_URL` 可保留为 fallback,但不应再被业务代码使用
- 两个 URL 必须经 `@taskaws/env` 的 zod 校验(url 格式、非空)

### FR-2: 读写分离的 DB 客户端

- `packages/db` 必须导出两个独立 Drizzle 实例:`dbWrite` 与 `dbRead`
- `dbWrite` 使用 `pg.Pool`(writer),用于 INSERT / UPDATE / DELETE
- `dbRead` 使用 `pg.Pool`(reader),仅用于 SELECT
- 两个 Pool 在模块级单例,不在请求中重复创建
- 现有单 `db` 导出可保留(兼容),但新代码必须明确用 `dbWrite` / `dbRead`

### FR-3: `github_users` Schema

字段(物理列名 snake_case,Drizzle 字段 camelCase):

| 字段 | 类型 | 约束 |
|------|------|------|
| id | uuid | PK, defaultRandom |
| github_id | integer | NOT NULL, **UNIQUE** |
| username | varchar(255) | NOT NULL |
| avatar_url | text | NOT NULL |
| bio | text | NULLABLE |
| public_repos | integer | NOT NULL, default 0 |
| updated_at | timestamp | NOT NULL, auto-update |

- **不再使用 `github_profiles` 表,不再带 `userId` FK**(本作业无登录系统,按 github_id 查)
- 唯一索引建在 `github_id` 上(同一 GitHub 用户只存一条)

### FR-4: 后端 Hono 路由(REST,非 tRPC)

| 方法 | 路径 | 数据源 | 说明 |
|------|------|--------|------|
| POST | `/api/github/sync` | `dbWrite`(Writer Endpoint) | 接收 `github_token`,调 GitHub API,upsert 到 `github_users` |
| GET | `/api/github/user/:github_id` | `dbRead`(Reader Endpoint) | 按 `github_id` 读本地同步数据 |
| DELETE | `/api/github/user/:github_id` | `dbWrite`(Writer Endpoint) | 按 `github_id` 物理删除 |

#### POST /api/github/sync

- Request Body: `{ "github_token": "ghp_xxx" }`
- 服务端用 `fetch("https://api.github.com/user", { Authorization: "token <github_token>" })`
- 必须带 `User-Agent: TaskAWS/1.0` 与 `Accept: application/vnd.github+json`
- GitHub 返回非 2xx → 返回 400 `{ "error": "Invalid GitHub token" }`
- 提取字段:`id, login, avatar_url, bio, public_repos`
- 用 `dbWrite` 执行 upsert(`ON CONFLICT (github_id) DO UPDATE`)
- Response 200: `{ "id", "github_id", "username", "avatar_url", "bio", "public_repos", "updated_at" }`

#### GET /api/github/user/:github_id

- Path 参数 `github_id` 必须是整数(zod 校验 `z.coerce.number().int()`)
- 用 `dbRead` 查 `WHERE github_id = ?`
- 找不到 → 404 `{ "error": "User not found" }`
- 找到 → 200 返回完整 profile 对象

#### DELETE /api/github/user/:github_id

- Path 参数 `github_id` 同上校验
- 用 `dbWrite` 执行 `DELETE FROM github_users WHERE github_id = ?`
- 成功 → 200 `{ "success": true }`
- 找不到 → 404 `{ "error": "User not found" }`(幂等:也可 200,本设计选 404 以便前端提示)

### FR-5: 前端 UI(单页面)

路由:`/github-sync`(新 route 文件 `apps/web/src/routes/github-sync.tsx`)

组件:
- **TokenInput**: 密码输入框 + 可见性切换 + "开始同步" 按钮
- **SyncButton**: Loading 态显示 spinner + "Syncing..."
- **ProfileCard**: 头像(64x64) + @username + bio + 公开仓库数 chip + 上次同步时间 + "擦除云端数据" 红色按钮
- **EmptyState**: 未同步时的占位(github 图标 + 提示文案)

交互状态机:
```
idle (EmptyState 显示)
  ↓ 点击"开始同步"
syncing (按钮 loading,禁输入)
  ↓ 成功
profile (显示 ProfileCard,可再次同步更新)
  ↓ 点击"擦除" + confirm 对话框
idle (清空状态)
```

数据获取:
- **不用 tRPC**(本次 GitHub 路由是纯 REST)
- 直接用 `fetch` 调后端 `http://localhost:3000/api/github/*`(URL 通过 `VITE_SERVER_URL` 读取)
- 同步成功后立刻 `GET /api/github/user/<github_id>` 拉最新数据展示

## 3. 非功能需求 (NFR)

### NFR-1: 类型安全
- 所有 zod schema 显式类型标注
- 前端响应数据必须 type-cast 到明确的 interface(`GithubUser`),不允许 `any`
- 后端 handler 内 `res.json()` 后做类型断言(`as GithubApiResponse`)

### NFR-2: 安全
- `github_token` 仅在服务端透传给 GitHub API,**绝不落库、绝不返回前端**
- CORS 仅允许 `env.CORS_ORIGIN`(本地 `http://localhost:5173`),**禁止 `*`**(安全规则)
- 输入校验:github_id 必须为正整数;github_token 长度 ≥ 20 字符(`ghp_` 或 `github_pat_` 前缀)
- GitHub API 超时:fetch 加 `AbortSignal.timeout(10_000)`(10 秒)
- User-Agent 必填(GitHub API 强制要求)

### NFR-3: 性能
- `writerPool` 与 `readerPool` 都是 `pg.Pool` 自带连接池;不在请求路径创建/销毁
- Reader Pool 的 `max` 可以比 Writer 大(读多写少场景,默认 writer:10 / reader:20)
- upsert 用 `ON CONFLICT` 单次往返,不先 SELECT 再 INSERT

### NFR-4: 可观测
- 错误响应统一格式:`{ "error": "string", "code"?: "string" }`
- GitHub API 失败时记日志(状态码 + 响应体前 200 字符),不暴露给前端
- 路由挂 Hono `logger()` 中间件,能看到每个请求耗时

## 4. 验收标准 (AC)

### AC-1: 端到端同步成功
1. 启动后端 `pnpm dev:server` 与前端 `pnpm dev:web`
2. 浏览器访问 `/github-sync`
3. 输入有效 PAT,点"开始同步"
4. 等待 Loading 结束,ProfileCard 显示正确的 @username / bio / 公开仓库数 / 同步时间
5. 直连 DB(Writer Endpoint)查 `github_users` 表,存在该 github_id 记录

### AC-2: GET 走 Reader Endpoint
- 在 `pg` 层或通过 Wireshark/日志验证:GET 请求的 SQL 打到 Reader Endpoint
- 实务上通过「reader pool 配置不同 host」即可满足,本 AC 通过代码 review 确认(看 `dbRead` 是否用 `DATABASE_READER_URL`)

### AC-3: DELETE 走 Writer Endpoint
- 同 AC-2,代码 review 确认 `dbWrite` 用 `DATABASE_WRITER_URL`
- 删除后再次 GET 返回 404

### AC-4: 无效 PAT 处理
- 输入错误 PAT → 前端显示错误提示(toast 或内联)
- 后端返回 400,不写库

### AC-5: 类型检查通过
- `pnpm check-types` 在 `packages/db`、`packages/env`、`apps/server`、`apps/web` 全部通过
- 无 `any` 类型(`biome check` 或 `tsc --strict`)

### AC-6: Migration 成功
- `pnpm db:generate` 生成 `github_users` 表的 migration
- `pnpm db:migrate` 在 Writer Endpoint 成功执行
- 表结构与 design.md 一致

## 5. 不在范围

- ❌ 不引入新认证(better-auth 保留,但本 feature 的接口不强制登录)
- ❌ 不用 tRPC(本次接口是纯 REST)
- ❌ 不做 AWS SAM / Lambda 部署(本地 Node.js 运行;部署另开 feature)
- ❌ 不做缓存层(Redis 等)
- ❌ 不做软删除(直接物理 DELETE)
- ❌ 不做多 GitHub 账户聚合(一次只同步一个 PAT 对应的用户)

## 6. 与旧版 specs 的关系

旧版 `specs/PLAN.md` / `docs/PRD.md` 描述的是「单 profile、userId FK、无读写分离」设计(`github_profiles` 表)。本 feature **完全替代** 该设计:
- Schema 从 `github_profiles` → `github_users`
- 查询键从 `userId` → `github_id`
- DB 客户端从 `db` → `dbWrite` + `dbRead`
- 旧版 `packages/db/src/schema/github.ts` 与 `packages/db/src/github/{reader,writer}.ts` 将被重写
- 旧的 Cycle 1-3 任务(在 `specs/tasks.md`)作废,以本 `tasks.md` 为准

Cycle 4-6(SAM / GitHub Actions / 文档)保留,等本 feature 完成后再推进。
