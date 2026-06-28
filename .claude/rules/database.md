---
description: 数据库开发规则，Drizzle ORM + node-postgres + PostgreSQL，适用于 @taskaws/db
---

# Database

## Drizzle ORM + node-postgres

### 配置概览

```
数据库: PostgreSQL
ORM: Drizzle ORM (drizzle-orm/node-postgres)
驱动: pg (node-postgres)，内置连接池
Migration: drizzle-kit
```

### 客户端初始化（`packages/db/src/index.ts`）

```typescript
import { env } from "@taskaws/env/server";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export function createDb() {
  return drizzle(env.DATABASE_URL, { schema }); // node-postgres，自带连接池
}

export const db = createDb();
```

`drizzle-orm/node-postgres` 底层使用 `pg.Pool`，长驻 Node 进程复用连接。不要在每个请求/procedure 里 `new Pool()` 或反复 `createDb()`。

### drizzle 配置（`packages/db/drizzle.config.ts`）

```typescript
import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({ path: "../../apps/server/.env" }); // DATABASE_URL 在 apps/server/.env

export default defineConfig({
  schema: "./src/schema",
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL || "" },
});
```

### 环境变量

```bash
# apps/server/.env
DATABASE_URL=postgresql://user:password@host:5432/taskaws
```

## Schema 设计

### 目录结构

```
packages/db/src/
├── schema/
│   ├── index.ts        # barrel：re-export 所有表
│   ├── auth.ts         # better-auth 表：user/session/account/verification
│   └── [feature].ts    # 按域拆分
├── migrations/         # drizzle-kit 生成的迁移
└── index.ts            # createDb() + db
```

### 认证表（`packages/db/src/schema/auth.ts`）

better-auth 要求的 `user` / `session` / `account` / `verification` 用 `pgTable` 定义，列名与 better-auth 约定一致（snake_case 物理列名）。所有表需导出 relations 以支持关联查询。

#### user 表

```typescript
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
});

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));
```

#### session 表（带索引）

```typescript
export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").$onUpdate(() => new Date()).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)]
);

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));
```

#### account 表（OAuth provider）

```typescript
export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").$onUpdate(() => new Date()).notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)]
);

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));
```

#### verification 表（邮箱验证/OAuth）

```typescript
export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
);
```

要点：
- 外键约束用 `.references(() => user.id, { onDelete: "cascade" })`，保证关联删除
- 常用查询字段（userId、identifier）加索引，避免 N+1
- relations 定义双向关联，支持 `db.query.user.findMany({ with: { sessions: true } })`

### 业务表示例（`packages/db/src/schema/github.ts`）

业务域表按功能模块拆分，与 auth 表平级放在 `schema/` 目录：

```typescript
import { relations } from "drizzle-orm";
import { pgTable, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const githubProfiles = pgTable(
  "github_profiles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    githubId: integer("github_id").notNull(),
    username: text("username").notNull(),
    avatarUrl: text("avatar_url").notNull(),
    bio: text("bio"),
    publicRepos: integer("public_repos").notNull().default(0),
    syncedAt: timestamp("synced_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => [
    uniqueIndex("github_profiles_user_id_idx").on(table.userId),
    uniqueIndex("github_profiles_github_id_idx").on(table.githubId),
  ]
);

export const githubProfilesRelations = relations(githubProfiles, ({ one }) => ({
  user: one(user, { fields: [githubProfiles.userId], references: [user.id] }),
}));
```

要点：
- 外键引用 auth 表（`user.id`），`onDelete: "cascade"` 保证用户删除时同步清理
- `uniqueIndex` 确保一对一关联（一个用户只能有一个 GitHub profile）
- `syncedAt` 记录同步时间，区分 `createdAt`（创建时间）和同步时间点

## 数据访问模式

### Reader/Writer 模式（推荐）

将数据库操作按读写分离，封装为 reader/writer 对象，避免在业务代码里直接调用 `db.select/insert`：

```typescript
// packages/db/src/github/reader.ts
import { eq } from "drizzle-orm";
import { db } from "../index";
import { githubProfiles } from "../schema";

export const githubReader = {
  /** 按 userId 查询已同步的 GitHub profile */
  getByUserId: async (userId: string) => {
    const [row] = await db
      .select()
      .from(githubProfiles)
      .where(eq(githubProfiles.userId, userId))
      .limit(1);
    return row ?? null;
  },
};

// packages/db/src/github/writer.ts
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../index";
import { githubProfiles } from "../schema";

export type UpsertGithubProfileInput = {
  userId: string;
  githubId: number;
  username: string;
  avatarUrl: string;
  bio: string | null;
  publicRepos: number;
};

export const githubWriter = {
  /** upsert：按 userId 插入或更新 */
  upsertByUserId: async (input: UpsertGithubProfileInput) => {
    const now = new Date();
    const [row] = await db
      .insert(githubProfiles)
      .values({
        id: randomUUID(),
        ...input,
        syncedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: githubProfiles.userId,
        set: {
          githubId: input.githubId,
          username: input.username,
          avatarUrl: input.avatarUrl,
          bio: input.bio,
          publicRepos: input.publicRepos,
          syncedAt: now,
          updatedAt: now,
        },
      })
      .returning();
    return row;
  },

  /** 按 userId 删除 profile */
  deleteByUserId: async (userId: string) => {
    await db.delete(githubProfiles).where(eq(githubProfiles.userId, userId));
    return { success: true as const };
  },
};
```

优势：
- **类型安全**：input 类型明确，避免 procedure 里拼参数
- **可测试**：reader/writer 可独立 mock，不依赖 tRPC context
- **复用性**：同一操作可在多个 procedure/hono 路由复用（如定时同步任务）
- **封装性**：业务层不直接接触 Drizzle API，降低 ORM 依赖

使用：
```typescript
// packages/api/src/routers/github.ts
import { githubReader, githubWriter } from "@taskaws/db/github";

export const githubRouter = router({
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    return githubReader.getByUserId(ctx.session.user.id);
  }),

  syncProfile: protectedProcedure.mutation(async ({ ctx }) => {
    const githubData = await fetchGitHubProfile(ctx.session.user.id);
    return githubWriter.upsertByUserId({ userId: ctx.session.user.id, ...githubData });
  }),
});
```

## 开发规范

### 查询

```typescript
import { eq } from "drizzle-orm";
import { db, user } from "@taskaws/db";

// ❌ N+1：循环里查关联
// ✅ 一次查 + with 关联
const rows = await db.query.user.findMany({ with: { sessions: true } });

// 基础查询
const u = await db.select().from(user).where(eq(user.email, "a@b.com"));
const [created] = await db.insert(user).values({ id, name, email }).returning();
await db.update(user).set({ name }).where(eq(user.id, id));
await db.delete(user).where(eq(user.id, id));
```

### 事务

```typescript
const result = await db.transaction(async (tx) => {
  const [u] = await tx.insert(user).values({ ... }).returning();
  await tx.insert(session).values({ userId: u.id, ... });
  return u;
});
```

### Upsert（插入或更新）

使用 `onConflictDoUpdate` 实现 upsert，避免先查再插/更新的两步操作：

```typescript
// 按唯一索引/主键冲突时更新
const [row] = await db
  .insert(githubProfiles)
  .values({
    id: randomUUID(),
    userId: input.userId,
    githubId: input.githubId,
    username: input.username,
    // ... 其他字段
  })
  .onConflictDoUpdate({
    target: githubProfiles.userId, // 唯一索引字段
    set: {
      githubId: input.githubId,
      username: input.username,
      updatedAt: new Date(),
    },
  })
  .returning();
```

要点：
- `target` 指定冲突检测字段（需有 unique index 或 primary key）
- `set` 定义冲突时更新的字段（不包含 target 字段本身）
- 常用于同步场景（GitHub profile、第三方数据），避免重复插入
- 性能优于 `SELECT + INSERT/UPDATE`，单次 DB 操作

### 分页（游标）

```typescript
export const list = protectedProcedure
  .input(z.object({ cursor: z.string().optional(), limit: z.number().min(1).max(100).default(20) }))
  .query(async ({ input, ctx }) => {
    const rows = await ctx.db.query.task.findMany({
      where: input.cursor ? gt(task.id, input.cursor) : undefined,
      limit: input.limit + 1,
      orderBy: task.id,
    });
    let nextCursor: string | undefined;
    if (rows.length > input.limit) nextCursor = rows.pop()!.id;
    return { rows, nextCursor };
  });
```

注意：当前 `ctx` 没注入 `db`，procedure 里通过 `import { db } from "@taskaws/db"` 使用，或在 context 里补 `db`。

## 数据库命令

```bash
pnpm db:generate   # 根据 schema 生成 migration 文件
pnpm db:push       # 直接把 schema 推到 DB（开发环境快速迭代）
pnpm db:migrate    # 运行 migration
pnpm db:studio     # Drizzle Studio
```

## 注意事项

- **索引**：常用过滤/排序字段建索引；复合查询用复合索引（`index("x_y_idx").on(table.x, table.y)`）。
- **大表加列/索引**：可能锁表，生产环境用 `db:migrate` 生成的 SQL 评估，必要时分批。
- **慢查询**：用 `EXPLAIN ANALYZE`；需要原始 SQL 时用 Drizzle 的 `sql` 模板（参数化），禁止字符串拼接。
- **连接**：长驻 Node 进程复用 `pg.Pool`；不要在热路径 `createDb()`。
- **时间戳**：用 `$onUpdate(() => new Date())` 自动维护 `updatedAt`。
