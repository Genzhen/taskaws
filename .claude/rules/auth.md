---
description: 认证开发规则，Better-Auth + Drizzle Adapter + Hono，适用于 @taskaws/auth
---

# Auth

## Better-Auth 配置

### 核心配置（`packages/auth/src/index.ts`）

```typescript
import { createDb } from "@taskaws/db";
import * as schema from "@taskaws/db/schema/auth";
import { env } from "@taskaws/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

export function createAuth() {
  const db = createDb();

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
    }),
    trustedOrigins: [env.CORS_ORIGIN],
    secret: env.BETTER_AUTH_SECRET, // 至少 32 字符
    baseURL: env.BETTER_AUTH_URL,
    emailAndPassword: {
      enabled: true,
    },
    advanced: {
      defaultCookieAttributes: {
        sameSite: "none", // 跨域前后端分离需要
        secure: true,
        httpOnly: true,
      },
    },
    plugins: [],
  });
}

export const auth = createAuth();
```

要点：
- 用 **`drizzleAdapter`**（不是 prisma adapter），`provider: "pg"`，schema 直接引用 `@taskaws/db/schema/auth` 的表定义。
- 不挂 `nextCookies()`（本项目不是 Next.js）。
- 跨域 SPA 场景下 cookie 必须 `sameSite: "none"` + `secure: true`，且 `CORS_ORIGIN` 与前端源一致、后端 CORS 开启 `credentials: true`。

### 环境变量（`packages/env/src/server.ts`）

```bash
BETTER_AUTH_SECRET=                        # openssl rand -base64 32（≥32 字符）
BETTER_AUTH_URL=http://localhost:3000      # 后端认证服务 URL
CORS_ORIGIN=http://localhost:3001          # 允许的前端源

# OAuth（可选，按需开启）
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

## 后端挂载（Hono）

```typescript
// apps/server/src/index.ts
import { auth } from "@taskaws/auth";

// better-auth 统一处理 /api/auth/* 下的注册/登录/登出/会话
app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));
```

CORS 必须带 `credentials: true`，否则跨域 cookie 不下发：

```typescript
app.use("/*", cors({
  origin: env.CORS_ORIGIN,
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}));
```

### 认证端点

```
POST /api/auth/sign-up/email    # 注册
POST /api/auth/sign-in/email    # 登录
POST /api/auth/sign-out         # 登出
GET  /api/auth/get-session      # 获取会话
```

## tRPC 上下文集成

```typescript
// packages/api/src/context.ts
import { auth } from "@taskaws/auth";
import type { Context as HonoContext } from "hono";

export async function createContext({ context }: { context: HonoContext }) {
  const session = await auth.api.getSession({
    headers: context.req.raw.headers, // 透传 Hono 原始请求头
  });
  return { auth: null, session };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
```

注意：当前 context 从 **Hono context** 取 `req.raw.headers`（不是 Next.js 的 `headers()`）。

### 受保护 procedure（`packages/api/src/index.ts`）

```typescript
import { initTRPC, TRPCError } from "@trpc/server";
import type { Context } from "./context";

export const t = initTRPC.context<Context>().create();
export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required", cause: "No session" });
  }
  return next({ ctx: { ...ctx, session: ctx.session } });
});
```

需要角色权限（如 admin）时：先在 schema 给 `user` 加 `role` 字段并在 better-auth `user.additionalFields` 声明，再新增一个基于 `protectedProcedure` 的 middleware 校验 `ctx.session.user.role`。

## 前端使用（React Router SPA）

```typescript
// apps/web/src/lib/auth-client.ts
import { env } from "@taskaws/env/web";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: env.VITE_SERVER_URL, // 指向后端 :3000
});
export const { signIn, signUp, signOut, useSession } = authClient;
```

```tsx
import { useSession, signIn, signOut } from "~/lib/auth-client";

export function AuthButton() {
  const { data: session, isPending } = useSession();
  if (isPending) return <div>Loading…</div>;
  if (!session) {
    return <button onClick={() => signIn.email({ email: "a@b.com", password: "secret" })}>Sign In</button>;
  }
  return (
    <div>
      <span>Welcome, {session.user.name}</span>
      <button onClick={() => signOut()}>Sign Out</button>
    </div>
  );
}
```

## 数据模型（Drizzle，`packages/db/src/schema/auth.ts`）

better-auth 要求的表由 schema 定义（`user` / `session` / `account` / `verification`），字段命名与 better-auth 约定一致。改字段时同步更新 `drizzleAdapter` 引用的 schema，并 `pnpm db:push`。

```typescript
// 现有 user 表（按需扩展）
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
});
```

扩展自定义字段（如 `role`、`credits`）：同时改 schema 表定义 + better-auth `user.additionalFields`，保证两边一致。

## OAuth（可选）

```typescript
export const auth = betterAuth({
  // ...
  socialProviders: {
    google: { clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! },
    github: { clientId: process.env.GITHUB_CLIENT_ID!, clientSecret: process.env.GITHUB_CLIENT_SECRET! },
  },
});
```

前端：`authClient.signIn.social({ provider: "google", callbackURL: "/dashboard" })`。

## 安全要点

- 密钥一律经 `@taskaws/env` 读取，绝不硬编码；`BETTER_AUTH_SECRET` 用 `openssl rand -base64 32` 生成。
- `trustedOrigins` 精确配置到生产域名，禁止 `*`；本地用 `http://localhost:3001`。
- 不可信的 session 数据从 DB 重新查，不信任 client 传入。
- 开启速率限制（`rateLimit: { enabled: true, window: "1m", max: 10 }`），生产用 HTTPS。
- 调试：`auth.api.getSession({ headers })` 打印 session 确认链路。
