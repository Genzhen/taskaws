---
description: TypeScript 代码风格规范，适用于 taskaws monorepo 所有包
---

# Coding Style

## TypeScript

- strict mode 始终开启，禁止 `any`（用 `unknown` + 类型收窄代替）
- 优先用 `type` 而非 `interface`（union/intersection 更灵活）
- 函数参数超过 3 个时用对象参数
- 导出优先用具名导出，`default export` 仅用于 React Router route 文件（`apps/web/src/routes/*.tsx`）

## 命名

- 组件：PascalCase（`SignInForm`）
- 函数/变量：camelCase（`getTaskById`）
- 常量：SCREAMING_SNAKE_CASE（`MAX_FILE_SIZE`）
- tRPC router：名词复数（`task`、`user`、`project`）
- DB：Drizzle 字段名 camelCase，物理列名/表名 snake_case（`pgTable("user", { name: text("name") })`）

## 文件结构

- 每个文件只做一件事，避免超过 200 行
- 相关 helper 放在同目录的 `utils.ts` 或 `helpers.ts`
- 类型定义和实现分开放时，类型文件用 `types.ts`

## 注释

- 只写 WHY，不写 WHAT
- 复杂业务逻辑/非显而易见的约束才加注释
- 不写多行 docstring，最多一行

## 格式

- 缩进：2 空格
- 单引号，无分号（Prettier 管）
- import 顺序：外部包 → monorepo 包（@taskaws/*）→ 本地相对路径

## Monorepo 导入

- workspace 内部包用 `@taskaws/*`（如 `@taskaws/db`、`@taskaws/api`、`@taskaws/env`）
- 不使用相对路径跨 package（`../packages/db/src` → `@taskaws/db`）
- 同 package 内用相对路径（`./utils`、`../routers/task`）
- 新建 package 时在 `tsconfig.base.json` 添加 paths 映射

## 环境变量

- 所有环境变量通过 `@taskaws/env` 读取（server 用 `@taskaws/env/server`，web 用 `@taskaws/env/web`）
- 绝不 `process.env.XXX` 直接读（不经校验）
- 前端可用变量加 `VITE_` 前缀，密钥不加 `VITE_`
- 新增变量时在对应 `packages/env/src/*.ts` 添加 zod schema

## React 19 组件

- 函数式组件 + Hooks，不用 class component
- Props 用 `type` 定义，可选参数加 `?` 或显式 `| undefined`
- 组件拆分：状态逻辑 → Hooks（`useXxx`），副作用 → Effects，渲染 → JSX
- 不在组件内直接操作 DOM（用 refs 或 state）
- Props drilling 超过 2 层时考虑 Context 或 tRPC 查询

## tRPC Procedure

- 每个 procedure 输入必须 zod 校验（`.input(z.object({ ... }))`）
- 需要登录的 procedure 用 `protectedProcedure`，不用 `publicProcedure` 后手动检查
- mutation 返回操作结果或变更后的数据（`.returning()`）
- query 用 Drizzle 的 `.query.xxx.findMany/findFirst`（关系查询更方便）
- 错误用 `TRPCError`，不 `throw new Error()`（前端能识别 code）
