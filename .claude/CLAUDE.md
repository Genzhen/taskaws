# CLAUDE.md - TaskAWS

## 项目概述

**TaskAWS** - 基于 Better T Stack 构建的全栈 monorepo 应用。

### 技术栈

- **前端**: React Router 7 (SPA, `ssr: false`) + React 19 + Tailwind CSS 4
- **后端**: Hono (`@hono/node-server`, port 3000) + Node.js runtime
- **API 层**: tRPC v11 (类型安全，挂在 `/trpc/*`)
- **数据库**: PostgreSQL
- **ORM**: Drizzle ORM (`drizzle-orm/node-postgres`) + drizzle-kit
- **认证**: Better-Auth (drizzleAdapter, 挂在 `/api/auth/*`)
- **Monorepo**: Turborepo + pnpm workspaces
- **数据获取**: TanStack Query + tRPC Client
- **UI**: shadcn 风格组件（`@taskaws/ui`，基于 @base-ui/react）+ lucide-react + sonner

### 项目结构

```
taskaws/
├── apps/
│   ├── web/              # React Router 7 前端 (SPA)
│   └── server/           # Hono 后端 (port 3000, tRPC + better-auth)
├── packages/
│   ├── api/              # tRPC routers、context、procedure 定义
│   ├── auth/             # Better-Auth 配置 (drizzleAdapter)
│   ├── db/               # Drizzle schema、客户端、migrations
│   ├── env/              # 环境变量验证 (@t3-oss/env-core, server / web)
│   ├── ui/               # 共享 UI 组件库 (@taskaws/ui)
│   └── config/           # 共享配置 (tsconfig.base.json)
└── .claude/
    ├── CLAUDE.md         # 本文件
    ├── rules/            # 开发规则
    ├── agents/           # gz-* subagent 定义
    ├── commands/         # /gz:* 斜杠命令
    ├── skills/           # gz-* skill
    ├── workflows/        # gz-ai-wf.js 编排脚本
    └── hooks/            # Codex Review Gate hooks
```

## 开发命令

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev              # 所有服务 (turbo dev)
pnpm dev:web          # 仅前端 (react-router dev)
pnpm dev:server       # 仅后端 (tsx watch, port 3000)

# 数据库操作 (Drizzle / drizzle-kit)
pnpm db:generate      # 生成 migration 文件
pnpm db:push          # 推送 schema 变更到数据库（开发环境）
pnpm db:migrate       # 运行 migration
pnpm db:studio        # Drizzle Studio

# 类型检查
pnpm check-types
```

## 环境变量

服务端变量定义在 `packages/env/src/server.ts`，由 `@taskaws/env/server` 校验；Drizzle 配置从 `apps/server/.env` 读取。

```bash
# 数据库
DATABASE_URL=          # PostgreSQL 连接字符串

# 认证
BETTER_AUTH_SECRET=    # 至少 32 字符的密钥
BETTER_AUTH_URL=       # 后端认证服务 URL (如 http://localhost:3000)
CORS_ORIGIN=           # 允许的前端源 (CORS)

# 前端 (VITE_ 前缀, packages/env/src/web.ts)
VITE_SERVER_URL=       # 后端 URL，供 better-auth client 使用

# 可选
NODE_ENV=              # development | production | test
```

## 关键集成点

- **后端入口**: `apps/server/src/index.ts` — Hono app，`cors` + `logger` 中间件，better-auth handler 挂在 `/api/auth/*`，tRPC 挂在 `/trpc/*`。
- **tRPC**: `packages/api/src/index.ts` 导出 `publicProcedure` / `protectedProcedure`；context 由 `packages/api/src/context.ts` 从 Hono context 构建（通过 `auth.api.getSession` 解析 session）。
- **认证**: `packages/auth/src/index.ts` — `drizzleAdapter(db, { provider: "pg", schema })`，schema 来自 `@taskaws/db/schema/auth`，`emailAndPassword.enabled`。
- **数据库**: `packages/db/src/index.ts` — `drizzle(env.DATABASE_URL, { schema })`（node-postgres）。schema 按域拆分在 `packages/db/src/schema/`（`auth.ts` 等）。
- **前端认证**: `apps/web/src/lib/auth-client.ts` — `createAuthClient({ baseURL: env.VITE_SERVER_URL })`。

## 开发规则

详见 `.claude/rules/` 目录:

- **[backend-api.md](rules/backend-api.md)** - Hono 后端与 tRPC API 规范
- **[database.md](rules/database.md)** - Drizzle + PostgreSQL 数据库规范
- **[auth.md](rules/auth.md)** - Better-Auth 认证配置
- **[frontend.md](rules/frontend.md)** - React Router 7 / React 19 / Tailwind CSS 4 前端规范
- **[coding-style.md](rules/coding-style.md)** - TypeScript 代码风格
- **[security.md](rules/security.md)** - 安全规范（密钥/认证/输入校验）
- **[testing.md](rules/testing.md)** - 测试规范
- **[git-workflow.md](rules/git-workflow.md)** - Git 提交规范

## 代码规范

- 使用 TypeScript strict mode
- 组件使用函数式组件 + Hooks
- API 使用 tRPC routers；受保护接口用 `protectedProcedure`
- 数据库操作通过 Drizzle Client（`@taskaws/db`）
- 环境变量通过 `@taskaws/env` 验证，绝不硬编码密钥/连接串

## 提交门禁（Codex Review Gate）

**所有 `git commit` 前自动触发 codex review，BLOCK 则拦截提交。**

本项目挂载了双层 Review Gate：

| Hook | 触发时机 | 机制 |
|------|---------|------|
| `pre-commit-review.cjs` | `git commit` 执行前（PreToolUse） | 拦截 Bash 调用，BLOCK 则拒绝提交 |
| `codex-review-on-stop.cjs` | Claude 每次停止时（Stop） | 若工作区有未提交改动则审查，BLOCK 则阻止停止 |

两层互为补充：PreToolUse 是主门禁（在提交点直接把守）；Stop hook 是兜底（捕获遗漏的未提交改动）。
依赖本机已安装 `codex` CLI；未安装时 hook 静默放行。任何工作流（`/gz:coding`、`/gz:wf`）均自动生效。

## 项目踩坑与教训

详见 **@specs/LESSONS.md** — 开发中遇到的问题与解决方案，持续追加形成自学习闭环。
