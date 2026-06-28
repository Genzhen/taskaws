---
name: gz-database-engineer
description: 数据库工程师 Skill，执行数据模型设计、migration、查询优化，适配 Drizzle ORM + PostgreSQL/node-postgres + drizzle-kit (taskaws)
---

# gz-database-engineer — 数据库工程师

> ⚠️ **栈适配说明**：本 skill 从原 headshot-studio 项目移植。正文详细示例若仍出现旧栈（Prisma schema.prisma / @prisma/adapter-neon / Neon Serverless 等），**一律以本仓库 `.claude/rules/` 与 `.claude/CLAUDE.md` 描述的 taskaws 真实栈为准**（Drizzle ORM + PostgreSQL/node-postgres + drizzle-kit，长驻进程复用 pg.Pool）。

执行数据库相关开发任务。遵循 taskaws 的 Drizzle ORM + PostgreSQL (node-postgres) + drizzle-kit 架构规范。

## 触发条件

由 `/gz:coding` 自动调用，当 task 涉及数据库开发时触发。

## 工作流程

### 1. 识别技术栈

Headshot Studio 数据库技术栈已固定：

- **数据库**: PostgreSQL
- **ORM**: Drizzle ORM (`drizzle-orm/node-postgres`, pg 连接池)
- **Migration**: drizzle-kit (db:generate / db:push / db:migrate / db:studio)
- **Schema 组织**: 按域拆分在 `packages/db/src/schema/` (`auth.ts` 等)，由 `schema/index.ts` re-export
- **客户端**: `packages/db/src/index.ts` 的 `createDb()` / `db` 单例

### 2. 读取上下文

必读文件：
- `.claude/rules/database.md`（Drizzle 规范、索引策略）
- `.claude/rules/auth.md`（认证数据模型约定）
- `design.md` 中的数据模型和接口契约
- `packages/db/src/schema/` 所有 .ts 文件
- `packages/db/src/migrations/` 演进历史与命名规范
- `packages/db/src/index.ts` 客户端初始化方式
- `packages/db/drizzle.config.ts` drizzle-kit 配置

### 3. 开发

**Migration：**

- 遵循项目已有的 migration 命名规范（`YYYYMMDDHHMMSS_descriptive_name`）
- 确保可回滚（up + down），破坏性变更需暂停确认
- 新表包含审计字段（`createdAt @default(now())`、`updatedAt @updatedAt`）
- 索引、外键、约束在 migration 中一并创建
- **破坏性变更（删列/改类型/删表）→ 停下**，回报影响与回滚方式，不擅自执行

**数据模型/Schema：**

- Schema 文件按功能拆分：
  - `auth.prisma` — Better-Auth 约定的 user/session/account/verification
  - `image.prisma` — 头像生成相关（image/job/style 等）
  - `payment.prisma` — 支付/套餐相关
  - `schema.prisma` — 主配置（generator/datasource）+ 公共 model
- 字段类型精确（enum 用 `enum` 不用 string，decimal 不用 float）
- 关联关系清晰定义，使用 `@relation` 明确 onDelete 行为
- 常用查询模式加复合索引：
  ```prisma
  @@index([userId, status])
  @@index([status, createdAt])
  ```

**Serverless 适配：**

- 客户端初始化必须用 `PrismaNeon` adapter（见 `packages/db/src/index.ts`）
- 单例模式避免开发环境热重载创建多个客户端
- 不在 Lambda handler 内 new PrismaClient
- 长查询避免事务长时间占用连接

**查询层：**

- 复杂查询封装为独立函数/repository
- 避免 N+1（使用 `include` 或 `select` 关联）
- 大数据量加分页（游标分页性能更好，参考 `rules/database.md`）
- 事务用 `prisma.$transaction(async (tx) => {...})`，自动重试

**Seed 数据：**

- 开发用测试数据创建 seed 脚本放 `packages/db/prisma/seed.ts`
- seed 不包含生产数据

### 4. 安全检查

- 连接字符串从 `env.DATABASE_URL` 读取（在 `packages/env/src/server.ts`）
- 参数化查询（Prisma 自动处理，不手写 raw SQL 拼接）
- 敏感字段（密码由 Better-Auth 处理，不在自定义模型重复实现）
- migration 不包含生产数据或密钥

### 5. 验证

```bash
pnpm db:generate     # 生成 Prisma 客户端
pnpm db:push         # 开发环境推送 schema 变更
pnpm db:migrate      # 运行迁移
pnpm check-types     # TypeScript 类型检查
```

验证 migration 可回滚（开发环境）：
```bash
pnpm db:migrate      # 正向
# 如需验证回滚
pnpm db:migrate -- --rollback
```

## 常见坑

| 问题 | 处理 |
| ---- | ---- |
| Migration 顺序冲突（多人开发） | 检查最新 migration 时间戳，避免冲突 |
| 大表加列/加索引锁表 | Neon Serverless 自动处理，大表考虑分批 |
| ORM 生成的 SQL 性能差 | 用 `EXPLAIN ANALYZE` 检查，必要时 `prisma.$queryRaw` |
| 外键级联删除意外删数据 | 默认用 `Restrict`，只在明确需要时用 `Cascade` |
| Prisma 客户端未更新 | schema 变更后必须 `pnpm db:generate` |
| Better-Auth 表结构被破坏 | 改 user/session/account 前对照 `rules/auth.md` |
| 未用 Serverless adapter | 必须 `new PrismaNeon({...})`，不直接 new PrismaClient |

## 输出

- 创建的 migration 文件和 schema 变更
- 验证结果（db:generate + db:migrate + check-types）
- schema 变更摘要与对下游（API/前端）的影响
- 需要其他工种配合的事项
