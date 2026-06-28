# Tasks Backlog: GitHub Profile Sync Manager

**当前执行状态**

| 字段 | 值 |
|------|-----|
| **当前 Cycle** | github-sync-rw — AWS 读写分离架构 |
| **当前 Task** | T1: env 变量改造 |
| **当前 Node** | N3: 执行 Task |
| **状态** | ⏳ 待执行 |
| **阻塞项** | 无 |

---

## Cycle 状态总览

| Cycle | 名称 | 状态 | 备注 |
|-------|------|------|------|
| github-sync-rw | AWS 读写分离架构 | ⏳ 待执行 | **当前** — 替代旧 Cycle 1-3 |
| aws-deployment | AWS SAM + GitHub Actions | 🔒 锁定 | 依赖 github-sync-rw — 详见 [specs/aws-deployment/tasks.md](aws-deployment/tasks.md) |
| Cycle 6 | 验证 + 文档 | 🔒 锁定 | 依赖 aws-deployment |

> **旧版 Cycle 1-3（清理+数据层 / Hono REST API / 前端页面）已被 `github-sync-rw` 完全替代**。
> 详见 `specs/github-sync-rw/requirements.md` 第 6 节"与旧版 specs 的关系"。

---

## Task 清单

### ⚡ github-sync-rw — AWS 读写分离架构（当前执行中）

> 目录：`specs/github-sync-rw/` | 替代旧 Cycle 1-3
>
> 参见 [tasks.md](github-sync-rw/tasks.md) 完整任务列表。

| Task | 名称 | 状态 | 负责人 | 完成时间 |
|------|------|------|--------|---------|
| T1 | env 变量改造 (WRITER/READER URL) | ⏳ | DB | — |
| T3 | schema 重设计 → github_users | ⏳ | DB | — |
| T11 | TokenInput + SyncButton 组件 | ⏳ | FE | — |
| T12 | ProfileCard + EmptyState 组件 | ⏳ | FE | — |
| T2 | 读写分离客户端 (dbWrite/dbRead) | ⏳ | DB | — |
| T4 | 生成 migration | ⏳ | DB | — |
| T5 | Reader 终节点 (dbRead) | ⏳ | DB | — |
| T6 | Writer 终节点 (dbWrite) | ⏳ | DB | — |
| T7 | POST /api/github/sync | ⏳ | BE | — |
| T8 | GET /api/github/user/:id | ⏳ | BE | — |
| T9 | DELETE /api/github/user/:id | ⏳ | BE | — |
| T10 | 注册路由 + 错误处理 | ⏳ | BE | — |
| T13 | GitHubSync 主容器（状态机） | ⏳ | FE | — |
| T14 | 路由注册 github-sync.tsx | ⏳ | FE | — |
| T15 | 端到端验证 (QA) | ⏳ | QA | — |

---

### ~~Cycle 1 — 清理 + 数据层~~（已被 github-sync-rw 替代）

| Task | 名称 | 状态 | 负责人 | 完成时间 |
|------|------|------|--------|---------|
| 1.1 | 移除 auth 系统 | ⏳ | — | — |
| 1.2 | 简化 schema（移除 user_id） | ⏳ | — | — |
| 1.3 | 重写 Reader/Writer 终节点 | ⏳ | — | — |
| 1.4 | 生成 migration | ⏳ | — | — |

### ~~Cycle 2 — Hono REST API~~（已被 github-sync-rw 替代）

| Task | 名称 | 状态 | 负责人 | 完成时间 |
|------|------|------|--------|---------|
| 2.1 | 重写 Hono 入口 | ⏳ | — | — |
| 2.2 | 实现 POST /api/github/sync | ⏳ | — | — |
| 2.3 | 实现 GET /api/github/user | ⏳ | — | — |
| 2.4 | 实现 DELETE /api/github/user | ⏳ | — | — |
| 2.5 | CORS + 错误处理 | ⏳ | — | — |

### ~~Cycle 3 — 前端页面~~（已被 github-sync-rw 替代）

| Task | 名称 | 状态 | 负责人 | 完成时间 |
|------|------|------|--------|---------|
| 3.1 | 重写 _index.tsx（无 auth） | ⏳ | — | — |
| 3.2 | TokenInput 组件 | ⏳ | — | — |
| 3.3 | SyncButton 组件 | ⏳ | — | — |
| 3.4 | EmptyState 组件 | ⏳ | — | — |
| 3.5 | ProfileCard 组件 | ⏳ | — | — |
| 3.6 | GitHubSync 主容器 | ⏳ | — | — |
| 3.7 | TopAppBar 组件 | ⏳ | — | — |
| 3.8 | BottomNav 组件 | ⏳ | — | — |
| 3.9 | 整合布局 | ⏳ | — | — |

### Cycle 4-6 — AWS 部署 (SAM + GitHub Actions + 验证)

> 目录：`specs/aws-deployment/` | 替代旧 Cycle 4-5
>
> 参见 [tasks.md](aws-deployment/tasks.md) 完整任务列表。

| Task | 名称 | 状态 | 负责人 | 完成时间 |
|------|------|------|--------|---------|
| T1 | env schema 扩展 (WRITER/READER URL) | ⏳ | DB | — |
| T2 | 拆分 app.ts + lambda.ts | ⏳ | BE | — |
| T3 | esbuild build:api 脚本 | ⏳ | BE | — |
| T4 | template.yaml (SAM) | ⏳ | BE | — |
| T5 | samconfig.toml | ⏳ | BE | — |
| T6 | .github/workflows/deploy.yml | ⏳ | BE | — |
| T7 | 验证 (sam validate / sam build) | ⏳ | QA | — |

### ~~Cycle 4 — SAM 模板~~（已被 aws-deployment 替代）

| Task | 名称 | 状态 | 负责人 | 完成时间 |
|------|------|------|--------|---------|
| 4.1 | VPC 网络 | ⏳ | — | — |
| 4.2 | 安全组 | ⏳ | — | — |
| 4.3 | RDS PostgreSQL | ⏳ | — | — |
| 4.4 | Lambda 函数 | ⏳ | — | — |
| 4.5 | API Gateway + S3/CloudFront | ⏳ | — | — |
| 4.6 | Outputs | ⏳ | — | — |

### ~~Cycle 5 — GitHub Actions~~（已被 aws-deployment 替代）

| Task | 名称 | 状态 | 负责人 | 完成时间 |
|------|------|------|--------|---------|
| 5.1 | Workflow 文件 | ⏳ | — | — |
| 5.2 | IAM 配置文档 | ⏳ | — | — |

### Cycle 6 — 验证 + 文档

| Task | 名称 | 状态 | 负责人 | 完成时间 |
|------|------|------|--------|---------|
| 6.1 | 本地端到端测试 | ⏳ | — | — |
| 6.2 | README.md | ⏳ | — | — |
| 6.3 | 部署文档 | ⏳ | — | — |

---

## 状态图例

- ⏳ 待执行
- 🔄 进行中
- ✅ 已完成
- 🔒 锁定（依赖未满足）
- ❌ 阻塞
- ⏸ 暂停
