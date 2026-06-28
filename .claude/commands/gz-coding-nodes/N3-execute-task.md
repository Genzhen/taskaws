# N3: 执行 Task 规范

## 开发要求
1. **UI 还原**：将设计稿 HTML/CSS 转换为 `packages/ui` 和 `apps/web` 中的 React 组件。
2. **后端实现**：在 `packages/api` 中编写 tRPC 路由，必须使用 Drizzle ORM (来自 `@taskaws/db`) 进行数据库操作。
3. **长驻 Node 进程适配**（Hono + @hono/node-server）：
   - 禁止使用任何需要在内存中持久存储的状态（无状态设计）。
   - 数据库连接复用模块级 `db` 单例（`pg.Pool`），不在 procedure 内重复 `createDb()`。
   - 外部调用必须设置合理的 Timeout。

## 自动化行为
- 修改 Drizzle schema（`packages/db/src/schema/*.ts`）后，必须执行 `pnpm db:generate` 生成 migration，并在需要时 `pnpm db:push`（开发）或 `pnpm db:migrate`（生产）。
- 每一行代码改动后，运行 `pnpm check-types` 确保类型安全。

✓ 执行完毕后，更新 specs/TASKS_BACKLOG.md「当前执行状态」中的「当前 Node」为 `N4: 审查`。