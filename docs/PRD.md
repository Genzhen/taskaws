# PRD: GitHub Profile Sync Manager (AWS 部署作业)

**版本**：v2.0
**日期**：2026-06-28
**状态**：Draft

---

## 1. 项目概述

**作业目标**：构建一个单页面应用，用户输入 GitHub Personal Access Token，后端调用 GitHub API 获取用户资料，存入 AWS RDS PostgreSQL，部署在 AWS VPC 内（Lambda + RDS 同 VPC），通过 SAM 部署，GitHub Actions CI/CD。

## 2. 作业要求清单

| # | 要求 | 技术实现 |
|---|------|---------|
| R1 | Hono 后端 + 单页面 | Hono (Node.js) + React Router 7 SPA |
| R2 | GitHub Token → 获取用户信息 → Drizzle 增删 | REST API + Drizzle ORM |
| R3 | SAM 部署到 AWS | VPC（1 公有 + 2 私有子网）+ Lambda + RDS |
| R4 | GitHub Actions + IAM 部署 | `.github/workflows/deploy.yml` |
| R5 | 按设计稿还原 UI | Terminal Prime 主题 |

## 3. 用户故事

### US-1：同步 GitHub 资料
**As a** 用户（无登录）
**I want to** 输入 GitHub PAT 并点击「Sync and Save to AWS」
**So that** 我的 GitHub 资料被存入 AWS RDS

**AC**：
- PAT 输入框 + visibility toggle
- Sync 按钮 loading 态
- 成功后展示 Profile Card（头像、@username、bio、repos 数、AWS 状态）
- 空状态 → Profile Card 切换动画

### US-2：查看已同步数据
**As a** 用户
**I want to** 页面加载时自动获取已同步数据
**So that** 不必每次重新同步

### US-3：删除数据
**As a** 用户
**I want to** 点击「Delete from DB」
**So that** 数据从 RDS 擦除（带 confirm）

## 4. 接口契约（REST API，Hono）

### POST /api/github/sync

**Request**:
```json
{ "pat": "ghp_xxxx" }
```

**Flow**: `fetch("https://api.github.com/user", { Authorization: token ${pat} })` → 提取字段 → Drizzle 写入

**Response 200**:
```json
{
  "id": "uuid",
  "githubId": 583231,
  "username": "octocat",
  "avatarUrl": "https://...",
  "bio": "Design assistant at GitHub",
  "publicRepos": 32,
  "syncedAt": "2026-06-28T10:00:00Z"
}
```

**Error 400**: `{ "error": "Invalid GitHub PAT" }`

### GET /api/github/user

**Response 200**: `{ "profile": {...} | null }`
**Response 404**: `{ "profile": null }`（无数据）

### DELETE /api/github/user

**Response 200**: `{ "success": true }`

## 5. 数据模型（Drizzle Schema）

详见 `specs/design.md`。核心表 `github_profiles`：

| 列名 | 类型 | 说明 |
|------|------|------|
| id | uuid PK | 主键 |
| github_id | integer UNIQUE | GitHub user ID |
| username | text | GitHub login |
| avatar_url | text | 头像 URL |
| bio | text? | 简介 |
| public_repos | integer | 公开仓库数 |
| synced_at | timestamp | 同步时间 |
| created_at | timestamp | 首次创建 |
| updated_at | timestamp | 最近更新 |

**注意**：无 `user_id`（作业不需要登录系统，只存一条 GitHub profile 记录）。

## 6. AWS 部署架构

```
┌─────────────────────────────────────────────────────┐
│                        VPC                           │
│                                                      │
│  ┌─────────────────┐   ┌─────────────────────────┐  │
│  │ 公有子网         │   │ 私有子网 A               │  │
│  │ ┌─────────────┐ │   │ ┌─────────────────────┐ │  │
│  │ │ NAT Gateway │ │──►│ │ Lambda (Hono API)   │ │  │
│  │ └─────────────┘ │   │ └─────────────────────┘ │  │
│  └─────────────────┘   └─────────────────────────┘  │
│           │                                          │
│           │         ┌─────────────────────────────┐  │
│           │         │ 私有子网 B                    │  │
│           │         │ ┌─────────────────────────┐ │  │
│           └────────►│ │ RDS PostgreSQL           │ │  │
│                     │ └─────────────────────────┘ │  │
│                     └─────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

**组件**：
- VPC + Internet Gateway
- 公有子网：NAT Gateway（让 Lambda 访问外部 GitHub API）
- 私有子网 A：Lambda 函数（运行 Hono）
- 私有子网 B：RDS PostgreSQL
- API Gateway（HTTP API，触发 Lambda）
- S3 + CloudFront（托管前端 SPA）

## 7. CI/CD（GitHub Actions）

```yaml
on: push to main
jobs:
  deploy:
    permissions:
      id-token: write    # OIDC
      contents: read
    steps:
      - checkout
      - pnpm install
      - pnpm build
      - sam build
      - sam deploy --no-confirm-changeset
```

使用 IAM OIDC Provider（GitHub → AWS），无需长期 Access Key。

## 8. UI 还原要点

设计稿：`/Users/gz/Desktop/Advance/Task/stitch_github_profile_sync_manager/code.html`

**组件**：
1. TopAppBar（sticky，sync_alt logo + 通知 bell + 占位头像）
2. Entry Point Card（PAT 输入 + visibility toggle + Sync 按钮）
3. Empty State（ghost 图标 + 虚线边框）
4. Profile Card（头像 + @username + bio + repos chip + AWS 状态 + Delete 按钮）
5. Mobile BottomNav（Dashboard/Repos/Logs/Settings）

**设计 Token**：
- Background: `#0d1117`
- Surface: `#161b22`
- Border: `#30363d`
- Primary: `#58a6ff`
- Success: `#238636`
- Danger: `#f85149`
- Font: Geist (headline) / Inter (body) / JetBrains Mono (code)

## 9. 不在范围

- ❌ 登录系统（better-auth）
- ❌ tRPC（用 REST API）
- ❌ 多用户（只存一条 profile）
- ❌ OAuth（只 PAT）

## 10. 技术栈

| 层 | 技术 |
|---|------|
| 前端 | React Router 7 (SPA) + Tailwind CSS 4 + lucide-react |
| 后端 | Hono (Node.js) + REST API |
| 数据库 | PostgreSQL + Drizzle ORM |
| 部署 | AWS SAM + Lambda + RDS + VPC + API Gateway + S3/CloudFront |
| CI/CD | GitHub Actions + IAM OIDC |
