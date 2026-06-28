# Plan: GitHub Profile Sync Manager

**最新修订**：2026-06-28 — 引入 [AWS 读写分离架构 (github-sync-rw)](github-sync-rw/design.md)

---

## ⚡ Feature 0: GitHub Sync RW (读写分离) — **当前执行中**

> 目录：`specs/github-sync-rw/` | 状态：⏳ 待执行
>
> **这是 Cycle 1-3 的重写版**：引入双数据库连接（Writer/Reader Endpoint）、
> 新 schema `github_users`（无 user FK）、按 `github_id` 索引、REST 路由带 `:github_id` 路径参数。
>
> 详见：[requirements.md](github-sync-rw/requirements.md) / [design.md](github-sync-rw/design.md) / [tasks.md](github-sync-rw/tasks.md)

---

## 旧版 Cycle Map（保留作历史参考）

> **注意**：以下 Cycle 1-3 已被 Feature 0 替代；Cycle 4-6(SAM / CI/CD / 验证)完成后可继续推进。

```
GitHub Profile Sync Manager (Epic)
├── Cycle 1: 清理 + 数据层（移除 auth/tRPC，建 schema）
├── Cycle 2: Hono REST API（3 个接口）
├── Cycle 3: 前端页面（设计稿还原）
├── Cycle 4: SAM 模板（VPC + Lambda + RDS）
├── Cycle 5: GitHub Actions CI/CD
└── Cycle 6: 验证 + 文档
```

## Cycle 详情

### Cycle 1 — 清理 + 数据层

**目标**：移除不需要的登录系统/tRPC，建立新的 Drizzle schema

**任务**：
- 移除 `packages/auth/`（不需要 better-auth）
- 移除 `packages/api/`（不需要 tRPC）
- 移除前端 auth-client / auth guard
- 更新 schema：`github_profiles` 表（无 user_id）
- 更新 DB package 导出
- 生成 migration

**产出**：
- `packages/db/src/schema/github.ts`
- `packages/db/src/github/reader.ts`
- `packages/db/src/github/writer.ts`
- `packages/db/src/migrations/0001_*.sql`

**验收**：`pnpm check-types` 通过

---

### Cycle 2 — Hono REST API

**目标**：实现 3 个 REST 接口

**任务**：
- `POST /api/github/sync`：PAT → GitHub API → Drizzle upsert
- `GET /api/github/user`：Drizzle read
- `DELETE /api/github/user`：Drizzle delete
- CORS 配置（`origin: "*"`）
- 错误处理（PAT 无效返回 400）

**产出**：
- `apps/server/src/index.ts`（重写）

**验收**：`pnpm check-types` 通过 + 手动 curl 验证

---

### Cycle 3 — 前端页面

**目标**：按设计稿还原 UI（单页面，无登录）

**任务**：
- TopAppBar（logo + 通知 + 占位头像）
- Entry Point Card（PAT 输入 + Sync 按钮）
- Empty State（ghost 图标）
- Profile Card（头像 + @username + bio + repos + Delete）
- Mobile BottomNav
- 状态机（empty → loading → profile）
- 调用 REST API（fetch，不是 tRPC）

**产出**：
- `apps/web/src/routes/_index.tsx`
- `apps/web/src/components/github-sync/`（5 个组件）

**验收**：UI 还原度 ≥ 90% + 交互正确

---

### Cycle 4-6 — AWS 部署 (SAM + GitHub Actions + 验证)

> 目录：`specs/aws-deployment/` | 状态：🔒 锁定（依赖 github-sync-rw 完成）
>
> **VPC / NAT / RDS 已手动建好**，本 Cycle 聚焦 IaC 模板化 + CI/CD 自动化：
> SAM 模板声明 Lambda + API Gateway + SecurityGroup（引用已有 VPC/Subnet），
> esbuild 打包 Hono 后端，GitHub Actions 实现 push-to-deploy。
>
> 详见：[requirements.md](aws-deployment/requirements.md) / [design.md](aws-deployment/design.md) / [tasks.md](aws-deployment/tasks.md)

**任务摘要（T1-T7）**：

| Task | 内容 | 产出 |
|------|------|------|
| T1 | env schema 扩展（DATABASE_WRITER/READER_URL） | `packages/env/src/server.ts` |
| T2 | 拆分 app.ts + lambda.ts | `apps/server/src/app.ts`、`lambda.ts` |
| T3 | esbuild build:api 脚本 | `apps/server/package.json` |
| T4 | template.yaml（SAM） | `template.yaml` |
| T5 | samconfig.toml | `samconfig.toml` |
| T6 | .github/workflows/deploy.yml | `.github/workflows/deploy.yml` |
| T7 | 验证（sam validate / sam build） | `.aws-sam/` 构建产物 |

**验收**：`sam validate --lint` 通过 + `sam build` 成功 + GitHub Actions YAML 语法正确

---

## 依赖关系

```
github-sync-rw (T1-T15)
    │
    └── AWS 部署 (T1-T7)
         ├── T1 (env) → T2 (lambda) → T3 (build) ─┐
         │                                          ├── T6 (CI/CD) → T7 (验证)
         └── T4 (SAM) → T5 (samconfig) ────────────┘
```

旧版 Cycle 1-3 已被 `github-sync-rw` 替代，Cycle 4-6 细化为此处的 T1-T7。
