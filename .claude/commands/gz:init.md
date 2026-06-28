# /gz:init — 项目初始化

1. 分析项目框架 (Better T Stack: React Router 7 (SPA) + Hono + tRPC v11 + Drizzle ORM + better-auth + Turborepo)。
2. 在 `.claude/` 下生成 `CLAUDE.md` 和 `rules/`。
3. 在 `rules/backend-api.md` 中说明 Hono + Node.js 长驻进程与模块级单例原则。
4. 生成 `rules/database.md`，包含 Drizzle + node-postgres 配置。
5. 生成 `rules/auth.md` 包含 Better-Auth 配置。

## 执行要求
- 识别 `{{设计稿目录：本项目暂无外部设计稿}}` 作为设计稿输入。
- **状态更新**：执行完成后，更新 `specs/TASKS_BACKLOG.md` 的「当前执行状态」，将「当前 Cycle」设为 Cycle 1，「当前 Node」设为 `N1: 初始化`。