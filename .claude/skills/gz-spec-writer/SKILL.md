---
name: gz-spec-writer
description: 将需求文档解析为结构化的 requirements.md、design.md、tasks.md，输出到项目 specs/ 目录，适配 Monorepo 架构
---

# gz-spec-writer — 需求规格生成器

> ⚠️ **栈适配说明**：本 skill 从原 headshot-studio 项目移植。正文详细示例若仍出现旧栈（Lambda / Prisma / Next.js 等），**一律以本仓库 `.claude/rules/` 与 `.claude/CLAUDE.md` 描述的 taskaws 真实栈为准**（React Router 7 SPA + Hono + Drizzle + node-postgres + better-auth）。

将原始需求文档转化为可执行的开发规格。

## 输入

调用者提供原始需求文本 `RAW_DOC`。

## 执行步骤

### 1. 探测项目架构类型

taskaws 已确认为 **Monorepo** 架构：

- **Monorepo 工具**: Turborepo + pnpm workspaces
- **Apps**: `apps/web` (React Router 7 SPA 前端)
- **Packages**: `packages/api`, `packages/auth`, `packages/db`, `packages/env`, `packages/ui`, `packages/config`

无需动态探测，直接按 Monorepo 策略处理。

### 2. 读取项目上下文

必读文件：
- `.claude/CLAUDE.md` 了解项目技术栈与目录结构
- `.claude/rules/` 下所有规则文件（backend-api.md, database.md, auth.md）
- 扫描 `apps/` 和 `packages/` 了解现有模块划分
- 检查 `specs/` 目录下已有的 feature specs（避免冲突）
- 读取 `specs/PLAN.md` 了解开发计划

### 3. 分析需求

从 `RAW_DOC` 中提取：
- 功能目标（用户要做什么）
- 用户故事（作为 X，我想要 Y，以便 Z）
- 验收标准（怎样算完成）
- 约束条件（性能、安全、部署考虑）
- 依赖（外部服务：外部 API、文件存储、支付、数据库）

### 4. 推断 feature 名称

根据需求内容生成一个简洁的 kebab-case 名称，如 `user-auth`、`image-generation`、`payment-checkout`。

### 5. 创建 specs 目录

```
specs/{feature-name}/
├── requirements.md
├── design.md
└── tasks.md
```

### 6. 生成 requirements.md

```markdown
# {Feature 名称} — 需求规格

## 概述
{一句话描述}

## 用户故事
- 作为 {角色}，我想要 {功能}，以便 {价值}

## 功能需求
1. {F-001} {需求描述}
2. {F-002} {需求描述}
...

## 非功能需求
- 性能: {要求 — 注意 长任务异步化（长驻 Node 进程无 30s 限制）}
- 安全: {要求}
- 兼容性: {要求}

## 验收标准
- [ ] {AC-001} {标准描述}
...

## 依赖
- {外部服务/库 — 如 第三方 API、对象存储、支付服务}

## 开放问题
- {待确认事项}
```

### 7. 生成 design.md

读取 `.claude/rules/` 确保设计方案符合项目规范：

```markdown
# {Feature 名称} — 技术设计

## 项目架构

- 架构类型: Monorepo (Turborepo + pnpm)
- 涉及模块: {本 feature 需要改动的 apps/packages}

## 方案概述
{技术实现思路}

## 架构变更
{涉及哪些模块，如何与现有架构集成}

## 数据模型
{新增/修改的 Drizzle schema — 注意 drizzle-kit 规范}

## API 契约
{tRPC procedure 定义 — router名.procedure名、输入 zod schema、输出类型}

## 组件设计
{新增/修改的 React 组件 — 标注 纯客户端 React 组件}

## 状态管理
{状态流转 — tRPC useQuery/useMutation 缓存策略}

## 安全考虑
{认证、授权、数据校验 — 基于 Better-Auth + tRPC protectedProcedure}

## 部署考虑
{长任务异步化、无状态设计、外部存储}

## 技术决策
| 决策 | 选项 | 理由 |
|------|------|------|
```

### 8. 生成 tasks.md

按 Monorepo 自底向上顺序拆解：

1. **共享包优先**: `packages/db` (schema) → `packages/api` (routers) → `packages/auth` (认证)
2. **前端应用**: `apps/web` (pages/components)
3. **集成测试**: E2E + 跨模块联调

```markdown
# {Feature 名称} — 任务清单

## 架构: Monorepo (Turborepo + pnpm)

## 任务列表

### Phase 1: 数据层 (packages/db)
- [ ] T-001: {schema 变更/migration} `packages/db/src/schema/{file}.ts` ~{预估时间}

### Phase 2: API 层 (packages/api)
- [ ] T-002: {tRPC router} `packages/api/src/routers/{name}.ts` ~{预估时间}
- [ ] T-003: {认证集成} `packages/auth/src/index.ts` ~{预估时间}

### Phase 3: 前端层 (apps/web)
- [ ] T-004: {页面/组件} `apps/web/src/routes/{route}.tsx` ~{预估时间}
- [ ] T-005: {UI 组件} `packages/ui/src/{component}.tsx` ~{预估时间}

### Phase 4: 集成测试
- [ ] T-006: {E2E 测试} `apps/web/e2e/{feature}.spec.ts` ~{预估时间}

## 依赖关系
- T-002 依赖 T-001 (router 需要 schema)
- T-004 依赖 T-002 (页面需要 API)
- 跨包依赖明确标注

## 风险点
- 长任务处理：{长任务处理方案}
- 第三方服务：{API key 未配置时的降级策略}
```

**任务拆解原则：**

- 每个任务原子性，可独立完成和验证
- 按依赖关系排序（被依赖的先做）
- 标注所属模块/包 + 具体文件路径
- 预估完成时间（5min / 15min / 30min / 1h）
- 共享包变更需列出所有消费方
- 前端可用 mock 并行开发，联调阶段再切真实 API

## 输出

完成后报告：
- Feature 名称
- Specs 路径：`specs/{feature-name}/`
- 总任务数和预估总时间
