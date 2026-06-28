# Design: GitHub Sync RW (AWS 读写分离)

**版本**：v1.0
**对应需求**：`specs/github-sync-rw/requirements.md`

---

## 1. 架构总览

```
                        ┌─────────────────────────────────────────────┐
                        │              AWS VPC                         │
                        │                                              │
                        │   ┌──────────────────────────────────────┐  │
  Browser ──HTTPS──►    │   │  应用服务器(Node.js + Hono, port 3000)│  │
  (React Router SPA)    │   │                                       │  │
                        │   │  ┌──────────────┐ ┌──────────────┐   │  │
                        │   │  │ POST /sync   │ │ GET /user/id │   │  │
                        │   │  │ DELETE       │ │              │   │  │
                        │   │  │  ↓ dbWrite   │ │  ↓ dbRead    │   │  │
                        │   │  └──────┬───────┘ └──────┬───────┘   │  │
                        │   └─────────┼────────────────┼───────────┘  │
                        │             │                │              │
                        │             │                │              │
                        │      ┌──────▼──────┐  ┌──────▼──────┐      │
                        │      │ Writer Pool │  │ Reader Pool │      │
                        │      │ (pg.Pool)   │  │ (pg.Pool)   │      │
                        │      └──────┬──────┘  └──────┬──────┘      │
                        │             │                │              │
                        │      ┌──────▼──────┐  ┌──────▼──────┐      │
                        │      │ Writer      │  │ Reader      │      │
                        │      │ Endpoint    │  │ Endpoint    │      │
                        │      │ (RDS Primary)│ │ (RDS Replica)│     │
                        │      └─────────────┘  └─────────────┘      │
                        └─────────────────────────────────────────────┘
                                                       │
                                                       │ (HTTPS)
                                                       ▼
                                              api.github.com/user
```

**关键点**:
- **应用服务器同时持有两个 `pg.Pool`**,启动时建好,请求间复用
- **写路径**:`POST /sync` 与 `DELETE /user/:id` → `dbWrite` → Writer Endpoint(RDS Primary,承担所有写入)
- **读路径**:`GET /user/:id` → `dbRead` → Reader Endpoint(RDS Replica,只读副本,可水平扩展)
- **外部 GitHub API**:应用服务器需通过 NAT Gateway 出公网(已在 VPC 配置好)

## 2. 模块职责

| 模块 | 文件 | 职责 |
|------|------|------|
| Env 验证 | `packages/env/src/server.ts` | 校验 `DATABASE_WRITER_URL` / `DATABASE_READER_URL` 是合法 url |
| DB 客户端 | `packages/db/src/index.ts` | 创建 `writerPool` / `readerPool`;导出 `dbWrite` / `dbRead`;可选保留旧 `db` 作 fallback |
| Schema | `packages/db/src/schema/github.ts` | 定义 `github_users` 表(无 user FK) |
| Domain 终节点 | `packages/db/src/github/reader.ts` + `writer.ts` | 封装 github_users 表的读/写操作,供路由调用 |
| Hono 路由 | `apps/server/src/routes/github.ts` | 实现 3 个 REST 接口,严格走对应 db 实例 |
| Server 入口 | `apps/server/src/index.ts` | 注册 `/api/github/*` 路由 |
| 前端页面 | `apps/web/src/routes/github-sync.tsx` | Route 文件(default export) |
| 前端组件 | `apps/web/src/components/github-sync/*` | TokenInput / SyncButton / ProfileCard / EmptyState / 容器 |

## 3. 数据模型

### 3.1 Drizzle Schema(`packages/db/src/schema/github.ts`)

```typescript
import { pgTable, uuid, integer, varchar, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const githubUsers = pgTable(
  "github_users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    githubId: integer("github_id").notNull(),
    username: varchar("username", { length: 255 }).notNull(),
    avatarUrl: text("avatar_url").notNull(),
    bio: text("bio"),
    publicRepos: integer("public_repos").notNull().default(0),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("github_users_github_id_idx").on(table.githubId),
  ],
);
```

**设计决策**:
- **为什么 `uuid` 主键**:与 better-auth 的 `user.id` 风格一致,前端暴露安全
- **为什么 UNIQUE 在 `github_id` 而非 `id`**:`github_id` 是业务键(GitHub 用户的全局唯一 ID),upsert 时 `ON CONFLICT (github_id)` 用得到
- **为什么无 `created_at`**:本表定位是「同步缓存」,只关心「最后更新时间」;如需审计再补
- **为什么无 `user_id` FK**:本作业无登录系统,profile 不按应用用户归属,直接按 github_id 查

### 3.2 与旧 schema 的对比

| 项 | 旧 (`github_profiles`) | 新 (`github_users`) |
|---|---|---|
| 主键 | text (手动 randomUUID) | uuid (defaultRandom) |
| 业务键 | userId FK (UNIQUE) | github_id (UNIQUE) |
| 关联 | 引用 `user.id` | 无 FK |
| 同步时间 | `synced_at` + `created_at` + `updated_at` 三个时间戳 | 仅 `updated_at`(同步即更新) |
| 用途 | 按应用用户查其 GitHub | 按 GitHub ID 查缓存 |

### 3.3 Migration 策略

1. 删除旧的 `github_profiles` 表(`DROP TABLE IF EXISTS github_profiles`)
2. 创建新的 `github_users` 表
3. 一个 migration 文件包含两步(在同一事务)

执行:`pnpm db:generate` → 检查生成的 SQL → `pnpm db:migrate`(走 Writer Endpoint)

## 4. 读写分离实现

### 4.1 DB 客户端(`packages/db/src/index.ts`)

```typescript
import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "@taskaws/env/server";
import * as schema from "./schema";

// 写库连接池:INSERT / UPDATE / DELETE
export const writerPool = new Pool({
  connectionString: env.DATABASE_WRITER_URL,
  max: 10, // 写少,10 连接够用
  idleTimeoutMillis: 30_000,
});

// 读库连接池:SELECT(走 RDS Reader Endpoint)
export const readerPool = new Pool({
  connectionString: env.DATABASE_READER_URL,
  max: 20, // 读多,留更多余量
  idleTimeoutMillis: 30_000,
});

export const dbWrite = drizzle(writerPool, { schema });
export const dbRead = drizzle(readerPool, { schema });

// 兼容旧调用(过渡期,新代码不应再用)
export const db = dbWrite;

export * from "./github";
```

**为什么两个 `Pool` 不共享**:
- RDS Reader Endpoint 与 Writer Endpoint 是不同 DNS host,连接串不同
- pg.Pool 一个实例只绑一个连接串
- 业务层通过 `dbWrite` / `dbRead` 命名明确分流,比「一个 db + 动态切」更安全

### 4.2 Reader 终节点(`packages/db/src/github/reader.ts`)

```typescript
import { eq } from "drizzle-orm";
import { dbRead } from "../index";
import { githubUsers } from "../schema";

export const githubReader = {
  /** 按 github_id 查询已同步的用户(走 Reader Endpoint) */
  getByGithubId: async (githubId: number) => {
    const [row] = await dbRead
      .select()
      .from(githubUsers)
      .where(eq(githubUsers.githubId, githubId))
      .limit(1);
    return row ?? null;
  },
};
```

### 4.3 Writer 终节点(`packages/db/src/github/writer.ts`)

```typescript
import { dbWrite } from "../index";
import { githubUsers } from "../schema";

export type UpsertGithubUserInput = {
  githubId: number;
  username: string;
  avatarUrl: string;
  bio: string | null;
  publicRepos: number;
};

export const githubWriter = {
  /** upsert:按 github_id 插入或更新(走 Writer Endpoint) */
  upsertByGithubId: async (input: UpsertGithubUserInput) => {
    const [row] = await dbWrite
      .insert(githubUsers)
      .values({
        githubId: input.githubId,
        username: input.username,
        avatarUrl: input.avatarUrl,
        bio: input.bio,
        publicRepos: input.publicRepos,
      })
      .onConflictDoUpdate({
        target: githubUsers.githubId,
        set: {
          username: input.username,
          avatarUrl: input.avatarUrl,
          bio: input.bio,
          publicRepos: input.publicRepos,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  },

  /** 按 github_id 物理删除(走 Writer Endpoint) */
  deleteByGithubId: async (githubId: number) => {
    const [row] = await dbWrite
      .delete(githubUsers)
      .where(eq(/* 需要 import eq */ eq, githubUsers.githubId, githubId))
      .returning();
    return { success: true as const, deleted: !!row };
  },
};
```

(实际代码里 `eq` 要从 `drizzle-orm` import,上面是伪代码展示意图)

## 5. 数据流

### 5.1 同步流程(`POST /api/github/sync`)

```
Browser                 Hono                  GitHub API           RDS Writer
   │                       │                       │                   │
   │ POST /sync {token}    │                       │                   │
   │ ─────────────────────►│                       │                   │
   │                       │ fetch /user           │                   │
   │                       │ ─────────────────────►│                   │
   │                       │ 200 + user JSON       │                   │
   │                       │ ◄─────────────────────│                   │
   │                       │                       │                   │
   │                       │ dbWrite.upsert        │                   │
   │                       │ ─────────────────────────────────────────►│
   │                       │ ON CONFLICT DO UPDATE │                   │
   │                       │ ◄─────────────────────────────────────────│
   │                       │                       │                   │
   │ 200 + profile         │                       │                   │
   │ ◄─────────────────────│                       │                   │
```

### 5.2 读取流程(`GET /api/github/user/:github_id`)

```
Browser                 Hono                                     RDS Reader
   │                       │                                         │
   │ GET /user/583231      │                                         │
   │ ─────────────────────►│                                         │
   │                       │ dbRead.select where github_id=583231    │
   │                       │ ───────────────────────────────────────►│
   │                       │ ◄───────────────────────────────────────│
   │                       │                                         │
   │ 200 + profile         │                                         │
   │ ◄─────────────────────│                                         │
```

### 5.3 前端状态机

```
┌────────────┐
│  idle      │ ─── 挂载时 GET /user/:id (可选,如已知 id)
└─────┬──────┘
      │ 输入 token + 点击"开始同步"
      ▼
┌────────────┐
│  syncing   │ 按钮 spinner + 输入框禁用
└─────┬──────┘
      │ POST /sync 成功
      ▼
┌────────────┐
│  profile   │ 显示 ProfileCard
└─────┬──────┘
      │ 点击"擦除云端数据" + confirm
      ▼
┌────────────┐
│  deleting  │ 按钮 loading
└─────┬──────┘
      │ DELETE /user/:id 成功
      ▼
┌────────────┐
│  idle      │ 回到初始状态
└────────────┘
```

任一阶段失败 → toast 错误提示,状态回退到上一稳定态。

## 6. 关键技术决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| REST vs tRPC | REST | 本次接口是「前端 ↔ 自家后端」的简单 CRUD,tRPC 的类型推导红利不大;且 PRD 指定 REST 路径 |
| 双 Pool vs 单 Pool 动态切 | 双 Pool 显式分流 | 代码审计时一眼能看出读写流向,不易写错;且两 Pool 配置(max/idle)可独立调优 |
| Schema 命名 `github_users` | 不用 `github_profiles` | 与新业务语义一致(按 github_id 查的「用户缓存」),避免与旧设计混淆 |
| 主键 uuid + UNIQUE github_id | 双键 | uuid 内部主键(前端暴露安全);github_id UNIQUE 保证同一 GitHub 用户只一条,且 upsert 用 |
| 不引入登录 | 公开接口 | 本作业是演示用;后续加登录可在路由前叠 `protectedProcedure`(若迁回 tRPC)或 Hono middleware |
| 错误码 404 | DELETE 找不到也 404 | 让前端能区分「成功删除」与「本就没数据」,用户体验更清晰 |
| PAT 不入库 | 仅透传 | 安全底线,见 NFR-2 |
| GitHub fetch 加超时 | AbortSignal.timeout(10s) | 防止 GitHub API 慢拖垮连接池 |

## 7. 错误处理策略

统一错误响应格式:

```typescript
{ "error": "Invalid GitHub token", "code": "INVALID_PAT" }
```

| 错误场景 | HTTP 状态 | code |
|---|---|---|
| 请求体缺字段 / 类型错 | 400 | `BAD_REQUEST` |
| PAT 无效(GitHub 返回 401) | 400 | `INVALID_PAT` |
| GitHub API 限流(403) | 502 | `UPSTREAM_RATE_LIMIT` |
| GitHub API 网络超时 | 504 | `UPSTREAM_TIMEOUT` |
| github_id 不存在 | 404 | `NOT_FOUND` |
| DB 连接失败 | 500 | `DB_ERROR` |
| 未预期异常 | 500 | `INTERNAL_ERROR` |

Hono 层用 `app.onError` 兜底,避免堆栈泄露到客户端。

## 8. 安全考量

| 风险 | 缓解 |
|---|---|
| PAT 泄露 | 仅服务端 fetch 透传,不入库,不回显;前端发完即丢 |
| DB 凭据 | 走 `.env`(本地)/ Secrets Manager(部署),绝不入库 |
| CORS 跨域滥用 | `origin: env.CORS_ORIGIN`(精确到前端源),`credentials: true` |
| XSS(前端) | 不用 `dangerouslySetInnerHTML`;GitHub 字段(bio 等)渲染为文本 |
| SQL 注入 | Drizzle 参数化查询,不拼接 SQL |
| 路径遍历 | 路径参数 `github_id` 用 zod `z.coerce.number().int().positive()` 严格校验 |
| Reader 误写 | 业务代码只用 `dbRead` 做 SELECT;即使有人调用 INSERT,底层 RDS Reader 也会拒绝(只读副本) |

## 9. 可测试性

- Reader / Writer 终节点可单独 unit test(mock `dbRead` / `dbWrite`)
- 路由可集成 test:起一个 Hono app,注入 mock 终节点
- 端到端:本地起 Node 服务 + 真实 RDS(或用 Docker PostgreSQL 临时模拟 reader/writer 同库)
