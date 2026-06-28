---
description: 后端开发规则，Hono + Node.js + tRPC v11，适用于 apps/server 与 packages/api
---

# Backend API

## Hono 后端（`apps/server/src/index.ts`）

- **运行时**：Node.js，`@hono/node-server`，监听 **port 3000**。**非 Serverless**——长驻进程，模块级初始化的客户端（db、auth、第三方 SDK）在请求间复用。
- 中间件顺序：`logger()` → `cors()`（`credentials: true`，`origin: env.CORS_ORIGIN`）→ 业务路由。
- 路由挂载：

```typescript
app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw)); // better-auth
app.use("/trpc/*", trpcServer({ router: appRouter, createContext: (_o, c) => createContext({ context: c }) })); // tRPC
app.get("/", (c) => c.text("OK")); // health
```

- 脚本：`pnpm dev:server`（tsx watch）/ `pnpm build`（tsdown）/ `start`（node dist）。

## tRPC v11 规范（`packages/api`）

### 结构

- `packages/api/src/index.ts`：`t = initTRPC.context<Context>().create()`，导出 `router` / `publicProcedure` / `protectedProcedure`。
- `packages/api/src/context.ts`：从 Hono context 解析 session（`auth.api.getSession`）。
- `packages/api/src/routers/index.ts`：聚合 `appRouter`，导出 `AppRouter` 类型供前端类型推断。

### 路由命名

```typescript
export const taskRouter = router({
  list:    publicProcedure.query(...),
  getById: publicProcedure.input(z.object({ id: z.string() })).query(...),
  create:  protectedProcedure.input(...).mutation(...),
  update:  protectedProcedure.input(...).mutation(...),
  delete:  protectedProcedure.input(...).mutation(...),
});
// 调用路径：POST /trpc/task.list、task.create 等
```

新增 router 后记得在 `routers/index.ts` 的 `appRouter` 里挂上。

### 输入校验（zod）

```typescript
export const create = protectedProcedure
  .input(z.object({
    title: z.string().min(1).max(200),
    status: z.enum(["TODO", "DOING", "DONE"]),
    dueAt: z.string().datetime().optional(),
  }))
  .mutation(async ({ input, ctx }) => {
    // input 已类型安全；通过 import { db } from "@taskaws/db" 操作数据库
  });
```

所有 procedure 输入必须 zod 校验，包括枚举。

### 错误处理

```typescript
import { TRPCError } from "@trpc/server";
throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
throw new TRPCError({ code: "FORBIDDEN", message: "No permission" });
throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid input" });
```

### 认证边界

需要登录的接口必须用 `protectedProcedure`，不要用 `publicProcedure` 后手动检查 session。需要权限分级时在 `protectedProcedure` 上叠 middleware（见 [auth.md](auth.md)）。

## 环境变量（`packages/env/src/server.ts`）

```bash
DATABASE_URL=postgresql://...
BETTER_AUTH_SECRET=<≥32 字符>
BETTER_AUTH_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:3001
NODE_ENV=development
```

经 `@taskaws/env/server` 校验，绝不 `process.env.XXX` 直接读。

## 日志与可观测

- 用 Hono 自带 `logger()` 或 `console`；复杂场景引入结构化日志（如 pino）。
- 长任务不要阻塞请求线程——放后台队列/定时任务，tRPC 立即返回 jobId，前端轮询或订阅状态。

## 不要做

- 不要在请求处理函数里 `createDb()` / new 客户端（用模块级单例）。
- 不要硬编码密钥/连接串（走 `@taskaws/env`）。
- 不要用字符串拼接 SQL（用 Drizzle `sql` 模板参数化）。
- 不要在 `publicProcedure` 里做需要登录的操作。

## 应用工厂模式（`apps/server/src/app.ts`）

### 结构分离

后端应用拆分为三部分，支持多运行环境：

```typescript
// apps/server/src/app.ts - 应用工厂
export function createApp() {
  const app = new Hono();
  // 中间件 + 路由配置...
  return app;
}

// apps/server/src/index.ts - Node.js 本地开发/生产
const app = createApp();
serve({ fetch: app.fetch, port: 3000 });

// apps/server/src/lambda.ts - AWS Lambda 部署
const app = createApp();
export const handler = handle(app);
```

**要点**：
- `app.ts` 纯粹构造 Hono app（无端口绑定），供多运行环境复用。
- `index.ts` 用于 Node.js 长驻进程（本地开发、Docker、VPS）。
- `lambda.ts` 用于 AWS Lambda + API Gateway（Serverless 部署）。
- 中间件/路由逻辑全在 `createApp()` 内，部署入口只负责适配运行环境。

### Lambda 部署（`apps/server/src/lambda.ts`）

```typescript
import { handle } from "hono/aws-lambda";
import { createApp } from "./app";

const app = createApp();
export const handler = handle(app);
```

- `hono/aws-lambda` 自动适配 API Gateway HTTP API (v2) 事件格式。
- 本地开发仍用 `pnpm dev:server`（监听 :3000），Lambda 部署用此 handler。
- 环境变量在 Lambda 配置（`DATABASE_URL`、`BETTER_AUTH_SECRET` 等），不依赖 `.env` 文件。

## Reader/Writer 数据访问模式

### 域模块结构（`packages/db/src/<domain>/`）

```typescript
packages/db/src/github/
├── reader.ts     # 只读操作（query）
├── writer.ts     # 写操作（insert/update/delete）
└── index.ts      # barrel export
```

**目的**：分离读/写职责，便于：
- 未来读写分离（Reader 读副本、Writer 主库）。
- 权限隔离（Reader 只需 SELECT 权限，Writer 需 INSERT/UPDATE/DELETE）。
- 测试隔离（Reader 可 mock，Writer 可事务回滚）。

### Reader 示例（`packages/db/src/github/reader.ts`）

```typescript
import { eq } from "drizzle-orm";
import { db } from "../index";
import { githubProfiles } from "../schema";

export const githubReader = {
  getByUserId: async (userId: string) => {
    const [row] = await db
      .select()
      .from(githubProfiles)
      .where(eq(githubProfiles.userId, userId))
      .limit(1);
    return row ?? null;
  },
};
```

### Writer 示例（`packages/db/src/github/writer.ts`）

```typescript
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../index";
import { githubProfiles } from "../schema";

export const githubWriter = {
  upsertByUserId: async (input) => {
    const [row] = await db
      .insert(githubProfiles)
      .values({ id: randomUUID(), ...input })
      .onConflictDoUpdate({
        target: githubProfiles.userId,
        set: { /* ... */ },
      })
      .returning();
    return row;
  },

  deleteByUserId: async (userId: string) => {
    await db.delete(githubProfiles).where(eq(githubProfiles.userId, userId));
    return { success: true };
  },
};
```

### tRPC Router 使用

```typescript
// packages/api/src/routers/github.ts
import { githubReader, githubWriter } from "@taskaws/db";

export const githubRouter = router({
  sync: protectedProcedure.input(...).mutation(async ({ input, ctx }) => {
    const profile = await githubWriter.upsertByUserId({
      userId: ctx.session.user.id,
      // ...
    });
    return { profile };
  }),

  getProfile: protectedProcedure.query(async ({ ctx }) => {
    const profile = await githubReader.getByUserId(ctx.session.user.id);
    return { profile };
  }),

  deleteProfile: protectedProcedure.mutation(async ({ ctx }) => {
    return githubWriter.deleteByUserId(ctx.session.user.id);
  }),
});
```

**要点**：
- Reader 用于 query 操作（`getProfile`）。
- Writer 用于 mutation 操作（`sync`、`deleteProfile`）。
- 域模块导出命名对象（`githubReader`、`githubWriter`），不裸导出函数。

## 外部 API 集成模式

### GitHub API 示例（`packages/api/src/routers/github.ts`）

```typescript
const res = await fetch("https://api.github.com/user", {
  headers: {
    Authorization: `token ${input.pat}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "TaskAWS/1.0",
    "X-GitHub-Api-Version": "2022-11-28",
  },
});

if (!res.ok) {
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: res.status === 401 ? "Invalid GitHub PAT" : "GitHub API unavailable",
  });
}

const ghUser = await res.json() as { id: number; login: string; /* ... */ };
```

**要点**：
- **认证**：`Authorization: token ${pat}`（Bearer token 格式按 API 文档）。
- **Accept**：指定 API 响应格式（如 `application/vnd.github+json`）。
- **User-Agent**：必填（GitHub API 要求），标识调用方。
- **API Version**：`X-GitHub-Api-Version` 确保稳定版本。
- **错误处理**：`res.ok` 判断，区分 401（凭证错误）与 5xx（服务不可用）。
- **类型收窄**：`as { id: number; /* ... */ }` 明确返回结构，避免 `any`。

### 通用模式

```typescript
// 1. 构造请求（headers 必填）
const res = await fetch(url, {
  method: "GET", // 或 POST
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "User-Agent": "TaskAWS/1.0",
    // API 特定 headers（如版本、Content-Type）
  },
  body: JSON.stringify(data), // POST 时
});

// 2. 错误处理（区分业务错误与系统错误）
if (!res.ok) {
  if (res.status === 401 || res.status === 403) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Invalid credentials" });
  }
  if (res.status >= 500) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "External API unavailable" });
  }
  throw new TRPCError({ code: "BAD_REQUEST", message: `API error: ${res.status}` });
}

// 3. 解析响应（明确类型）
const data = await res.json() as { /* 结构 */ };
```

## Router 组织与健康检查

### Router 聚合（`packages/api/src/routers/index.ts`）

```typescript
import { githubRouter } from "./github";

export const appRouter = router({
  healthCheck: publicProcedure.query(() => "OK"),
  privateData: protectedProcedure.query(({ ctx }) => ({
    message: "This is private",
    user: ctx.session.user,
  })),
  github: githubRouter,
});
export type AppRouter = typeof appRouter;
```

**要点**：
- `appRouter` 聚合所有子 router（按域拆分：`githubRouter`、`taskRouter` 等）。
- `healthCheck` 简单返回 `"OK"`，用于部署验证（GET `/trpc/healthCheck`）。
- `privateData` 演示受保护 procedure（返回 session user 信息）。
- **导出类型**：`AppRouter` 供前端 tRPC client 类型推断（`trpc.task.list.useQuery()` 自动类型安全）。

### 新增 Router 步骤

1. 在 `packages/api/src/routers/` 创建 `<domain>.ts`。
2. 导入 `protectedProcedure` / `publicProcedure`，定义 router。
3. 在 `routers/index.ts` 的 `appRouter` 里挂载：`<domain>: <domainRouter>`。
4. 前端自动获得类型：`trpc.<domain>.<procedure>.useQuery()`。
