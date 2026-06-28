---
description: 测试规范，适用于 taskaws（Vitest 单元/集成 + Playwright E2E）
---

# Testing

## 框架

- 单元/集成测试：Vitest（**当前尚未接入**；添加时在各 package 装 `vitest` 并配 `vitest.config.ts` + `test` 脚本）
- E2E：Playwright（按需添加，覆盖 `apps/web` 关键路径）
- 测试数据库：独立开发库或本地 Docker PostgreSQL（不用生产库）

## 原则

- 不 mock 数据库——集成测试直接打真实 DB（避免假 mock 掩盖 migration/schema 问题）
- 只 mock 外部第三方 API
- 测试文件放在被测文件旁：`routers/task.ts` → `routers/task.test.ts`

## tRPC 测试

```typescript
import { appRouter } from "../routers";
import type { Context } from "../context";

test("task.create 需要登录", async () => {
  const ctx: Context = { auth: null, session: null }; // 无 session
  const caller = appRouter.createCaller(ctx);

  await expect(caller.task.create({ title: "x" })).rejects.toMatchObject({
    code: "UNAUTHORIZED",
  });
});
```

## 覆盖率目标

- 核心 tRPC procedures：> 70%
- 工具函数：> 80%
- UI 组件：Playwright E2E 覆盖关键路径，不写 unit test

## 禁止项

- 不写只测试实现细节的测试（改重构就挂的脆测试）
- 不写没有断言的测试
- 不在测试里硬编码生产 API Key

## Monorepo 测试（Turborepo）

### 按包运行

```bash
# 运行所有包的测试（并行）
turbo test

# 运行特定包
turbo test --filter=@taskaws/api
turbo test --filter=web

# 串行运行（避免 DB 连接池竞争）
turbo test --concurrency=1
```

### 配置 turbo.json

```json
{
  "pipeline": {
    "test": {
      "dependsOn": ["build"],
      "outputs": [],
      "cache": true
    }
  }
}
```

测试结果可缓存（无副作用），但集成测试打 DB 时需 `cache: false` 或 `--force`。

## React Router 7 SPA 测试

### 组件测试（Vitest + React Testing Library）

```typescript
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AuthButton } from "../auth-button";

describe("AuthButton", () => {
  it("renders loading state", () => {
    render(<AuthButton />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });
});
```

### 路由测试（MemoryRouter）

```typescript
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router";

const router = createMemoryRouter([{ path: "/", Component: HomePage }]);
render(<RouterProvider router={router} />);
```

不测 SSR（本项目 SPA 模式），所有路由组件在客户端渲染。

## 环境配置

### 测试环境变量

每个 package 的 `vitest.config.ts` 加 `env` 加载：

```typescript
import dotenv from "dotenv";
import { defineConfig } from "vitest/config";

dotenv.config({ path: "../../apps/server/.env.test" }); // 独立测试环境

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      NODE_ENV: "test",
    },
  },
});
```

创建 `.env.test`（不提交），使用独立测试数据库：

```bash
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/taskaws_test
```

### Vitest 配置模板

```typescript
// packages/api/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    globals: true,
    setupFiles: ["./test-setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
    },
  },
});
```

## 数据库测试（Drizzle + PostgreSQL）

### 测试前初始化

```typescript
// packages/api/test-setup.ts
import { beforeAll, afterAll, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@taskaws/db/schema";
import { migrate } from "drizzle-orm/node-postgres/migrator";

let pool: Pool;
let db: ReturnType<typeof drizzle>;

beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: "../db/src/migrations" });
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  // 清空表（或用 transaction rollback）
  await db.delete(schema.user);
});
```

### 事务回滚策略（推荐）

```typescript
import { setIsolationLevel } from "drizzle-orm/pg-core";

test("task.create", async () => {
  await db.transaction(async (tx) => {
    await setIsolationLevel(tx, "SERIALIZABLE");
    // 测试逻辑...
    // 结束后自动 rollback（不 commit）
  });
});
```

不污染 DB，适合并行测试。

## Better-Auth 测试

### 模拟会话

```typescript
import { auth } from "@taskaws/auth";

test("protected procedure", async () => {
  // 创建测试用户 + session
  const { user, session } = await auth.api.signInEmail({
    email: "test@example.com",
    password: "testpass",
  });

  const ctx: Context = { auth: null, session };
  const caller = appRouter.createCaller(ctx);

  const result = await caller.task.list();
  expect(result).toBeDefined();
});
```

### 登录/注册流程 E2E

Playwright 测试 `/login` → `/dashboard` 重定向：

```typescript
test("sign in flow", async ({ page }) => {
  await page.goto("/login");
  await page.fill("[name=email]", "test@example.com");
  await page.fill("[name=password]", "testpass");
  await page.click("button[type=submit]");
  await expect(page).toHaveURL("/dashboard");
});
```

## CI/CD 集成

### GitHub Actions

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_DB: taskaws_test
          POSTGRES_PASSWORD: test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm db:migrate
        env:
          DATABASE_URL: postgresql://postgres:test@postgres:5432/taskaws_test
      - run: turbo test
```

### Playwright CI

```yaml
- run: pnpm exec playwright install --with-deps
- run: turbo test --filter=web
- uses: actions/upload-artifact@v4
  if: failure()
  with:
    name: playwright-report
    path: apps/web/playwright-report/
```

## 常用命令

```bash
# 单元/集成测试（接入 Vitest 后）
pnpm test                # turbo test（所有包）
pnpm test:api            # turbo test --filter=@taskaws/api
pnpm test:coverage       # vitest run --coverage

# E2E（Playwright）
pnpm test:e2e            # playwright test
pnpm test:e2e:ui         # playwright test --ui
pnpm test:e2e:debug      # playwright test --debug

# 类型检查（当前主要验证手段）
pnpm check-types         # tsc --noEmit 全包
```
