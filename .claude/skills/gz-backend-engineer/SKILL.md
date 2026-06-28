---
name: gz-backend-engineer
description: 后端工程师 Skill，执行服务端业务开发，适配 Hono + tRPC v11 + Better-Auth + Drizzle ORM + PostgreSQL (taskaws)
---

# gz-backend-engineer — 后端工程师

> ⚠️ **栈适配说明**：本 skill 从原 headshot-studio 项目移植。正文详细示例若仍出现旧栈（Next.js App Router / Prisma / Neon / Lambda 等），**一律以本仓库 `.claude/rules/` 与 `.claude/CLAUDE.md` 描述的 taskaws 真实栈为准**（React Router 7 SPA + Hono + Drizzle + node-postgres + better-auth）。

执行后端开发任务。遵循 taskaws 的 Hono + tRPC v11 + Better-Auth + Drizzle + PostgreSQL 架构规范。

## 触发条件

由 `/gz:coding` 自动调用，当 task 涉及后端开发时触发：tRPC procedure、Better-Auth 配置、服务端业务逻辑、环境变量 schema、第三方服务（AI 图像生成、S3 存储、Polar 支付）集成。

## 工作流程

### 1. 识别技术栈

Headshot Studio 技术栈已固定，无需动态识别：

- **后端框架**: Hono (`@hono/node-server`, port 3000)，长驻 Node 进程（非 Serverless）
- **RPC 层**: tRPC v11 (在 `packages/api`)
- **认证**: Better-Auth + drizzleAdapter (在 `packages/auth`)
- **数据访问**: Drizzle ORM + node-postgres (在 `packages/db`)
- **环境变量**: @t3-oss/env-core (在 `packages/env`)

### 2. 读取上下文

必读文件：
- `.claude/rules/backend-api.md`（Lambda 约束、tRPC 规范）
- `.claude/rules/auth.md`（Better-Auth 配置）
- `.claude/rules/database.md`（Prisma Serverless 配置）
- `design.md` 中的接口契约、数据模型、安全考虑
- `packages/api/src/` 现有 routers、context、trpc.ts
- `packages/auth/src/index.ts` 当前 auth 配置

### 3. 开发

**tRPC procedure：**

- 复用 `packages/api/src/trpc.ts` 已导出的 `router`、`publicProcedure`、`protectedProcedure`、`adminProcedure`，**绝不重复 initTRPC**
- 新 router 文件放 `packages/api/src/routers/{domain}.ts`，并在 `packages/api/src/index.ts` 的 appRouter 聚合
- query 用于读、mutation 用于写；命名用动词（list/getById/create/update/delete）
- 输入一律 `z.object({...})` 校验，不信任客户端数据
- 受保护接口统一用 `protectedProcedure`，不在 handler 内重复解析 session

**认证：**

- 复用 `@taskaws/auth` 导出的 `auth` 实例
- 通过 `auth.api.getSession({ headers })` 获取 session
- social provider、密码重置等回调凭证经 `@taskaws/env` 注入，禁止硬编码
- 新增 user 字段时同步更新 `packages/auth/src/index.ts` 的 `user.additionalFields`

**第三方服务集成：**

- AI 图像生成（Replicate/FAL/OpenAI 等）：密钥经 env schema 校验后读取
- S3 存储：使用 `@aws-sdk/client-s3`，无状态，文件 URL 落库
- Polar 支付：遵循 `packages/api/src/routers/` 中已有支付模式
- 外部服务未配置（缺 API key）→ 先实现完整对接代码，调用处降级占位并标注 `// TODO: configure {SERVICE}_API_KEY`，不阻塞

**错误处理：**

- 抛 `TRPCError` 带 `code`（NOT_FOUND/UNAUTHORIZED/FORBIDDEN/BAD_REQUEST）
- 认证失败返回统一错误，不泄露账号是否存在
- 不在 handler 内 try/catch 吞错误

**Lambda 适配：**

- 无状态设计：不在内存缓存用户数据，不写本地文件（用 S3）
- `/tmp` 临时目录 512MB-10GB，仅用于流式处理中间产物
- 长任务（>30s）异步化：返回 jobId，由 Step Functions/SQS 处理
- 数据库连接复用 `@prisma/adapter-neon` 的连接池

### 4. 安全检查

- 密钥/连接串/token 从 `@taskaws/env` 读取，绝不硬编码
- 所有外部输入 schema 校验
- 会话/权限边界正确：`protectedProcedure` 必须用于需认证接口
- CORS 通过 `env.CORS_ORIGIN` 配置，不写死域名

### 5. 验证

```bash
pnpm check-types   # TypeScript 类型检查
pnpm check         # ESLint
pnpm build         # 构建验证
```

如有 dev server，启动确认服务端无启动期报错：
```bash
pnpm dev:web       # Next.js 开发服务器 (port 3001)
```

## 常见坑

| 问题                          | 处理                                                       |
| ----------------------------- | ---------------------------------------------------------- |
| 在 handler 里重复解析会话     | 统一从 ctx.session / ctx.auth 取，不重新读请求头          |
| 重复初始化 tRPC 实例          | 复用 `packages/api/src/trpc.ts` 导出的基类                 |
| 裸读 process.env              | 先在 `packages/env/src/server.ts` 补 schema 再消费         |
| 输入未校验直接落库            | 所有 mutation/query 输入走 zod                             |
| schema 变更与 auth 配置不一致 | 认证表改动与 `packages/auth` 配置同步                      |
| 第三方密钥硬编码              | 一律经 `@taskaws/env` 注入                         |
| Lambda 内同步长任务           | 返回 jobId，异步处理                                       |
| 内存中缓存大文件              | 用 S3 + 流式处理                                           |

## 输出

- 创建/修改的文件列表
- 验证结果（typecheck + lint + build）
- 接口契约（供前端对接）与待配合事项（如需 DB schema 变更）
- 需用户确认的环境变量或第三方服务配置
