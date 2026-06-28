# Tasks: GitHub Profile Sync Manager

按 Cycle 拆分，每个 Task 含文件清单、依赖、验收。

---

## Cycle 1 — 清理 + 数据层

### Task 1.1: 移除 auth 系统

**文件**：
- 删除 `packages/auth/` 目录
- 删除 `apps/web/src/lib/auth-client.ts`
- 移除 `apps/server/src/index.ts` 中的 better-auth handler
- 移除 `packages/api/` 目录（tRPC）
- 更新 `apps/web/src/routes/_index.tsx`（移除 auth guard）
- 更新 `apps/web/src/root.tsx`（移除 session 查询）
- 更新 `pnpm-workspace.yaml`（移除 auth/api packages）

**依赖**：无
**验收**：`pnpm check-types` 通过（可能需要先完成 1.2-1.4）

### Task 1.2: 简化 schema（移除 user_id）

**文件**：
- 重写 `packages/db/src/schema/github.ts`（无 userId FK）
- 更新 `packages/db/src/schema/index.ts`
- 更新 `packages/db/src/schema/auth.ts`（保留 user 表但不再 FK）

**依赖**：Task 1.1
**验收**：schema 编译通过

### Task 1.3: 重写 Reader/Writer 终节点

**文件**：
- 重写 `packages/db/src/github/reader.ts`（get 单条记录）
- 重写 `packages/db/src/github/writer.ts`（upsert/deleteAll）

**依赖**：Task 1.2
**验收**：`pnpm check-types` 通过

### Task 1.4: 生成 migration

**命令**：`pnpm db:generate`
**验收**：migration SQL 包含 `github_profiles` 表（无 user_id 列）

---

## Cycle 2 — Hono REST API

### Task 2.1: 重写 Hono 入口

**文件**：
- 重写 `apps/server/src/index.ts`
  - 移除 tRPC handler
  - 移除 better-auth handler
  - 添加 3 个 REST 路由

**依赖**：Cycle 1
**验收**：`pnpm check-types` 通过

### Task 2.2: 实现 POST /api/github/sync

**文件**：
- `apps/server/src/index.ts`（路由逻辑）

**逻辑**：
1. 接收 `{ pat: string }`
2. `fetch("https://api.github.com/user", { Authorization: token ${pat} })`
3. 校验响应（非 200 → 400）
4. 提取字段：`id, login, avatar_url, bio, public_repos`
5. `githubWriter.upsert(...)`
6. 返回 profile

**验收**：curl 测试成功

### Task 2.3: 实现 GET /api/github/user

**逻辑**：`githubReader.get()` → 返回 `{ profile }`

**验收**：curl 测试返回数据或 null

### Task 2.4: 实现 DELETE /api/github/user

**逻辑**：`githubWriter.deleteAll()` → 返回 `{ success: true }`

**验收**：curl 测试删除成功

### Task 2.5: CORS + 错误处理

**配置**：
- `cors({ origin: "*" })`（开发环境）
- 错误响应：`{ error: "message" }` + 状态码

**验收**：跨域请求正常

---

## Cycle 3 — 前端页面

### Task 3.1: 重写 _index.tsx（无 auth）

**文件**：
- `apps/web/src/routes/_index.tsx`
  - 移除 `useSession()` + `useNavigate()`
  - 直接渲染 `<GitHubSync />`

**依赖**：无
**验收**：首页直接显示 GitHub Sync UI

### Task 3.2: TokenInput 组件

**文件**：
- `apps/web/src/components/github-sync/token-input.tsx`

**UI**：
- label: "Personal Access Token"
- input: type=password + visibility toggle
- placeholder: "Enter your GitHub PAT..."
- hint: "Hint: Token needs read:user permission"

**验收**：与设计稿一致

### Task 3.3: SyncButton 组件

**文件**：
- `apps/web/src/components/github-sync/sync-button.tsx`

**状态**：
- idle: bg `#58a6ff`，文字 "Sync and Save to AWS"
- loading: spinner + "Syncing..."
- success: bg `#238636`，文字 "Synced Successfully"

**验收**：状态切换正确

### Task 3.4: EmptyState 组件

**文件**：
- `apps/web/src/components/github-sync/empty-state.tsx`

**UI**：ghost 图标 + 虚线边框 + 文案

**验收**：与设计稿一致

### Task 3.5: ProfileCard 组件

**文件**：
- `apps/web/src/components/github-sync/profile-card.tsx`

**UI**：
- 头像（64x64）+ 绿色 check 徽标
- `@username` + repos chip
- bio 文案
- "AWS VPC: Synced" 状态
- Delete 按钮（danger 色）

**验收**：与设计稿一致

### Task 3.6: GitHubSync 主容器

**文件**：
- `apps/web/src/components/github-sync/index.tsx`

**逻辑**：
- 挂载时 `fetch("/api/github/user")`
- 状态机：empty → loading → profile
- Sync：`POST /api/github/sync`
- Delete：`DELETE /api/github/user` + confirm

**验收**：完整交互流程

### Task 3.7: TopAppBar 组件

**文件**：
- `apps/web/src/components/github-sync/top-bar.tsx`

**UI**：sync_alt logo + 通知 bell + 占位头像（无 session 查询）

**验收**：与设计稿一致

### Task 3.8: BottomNav 组件

**文件**：
- `apps/web/src/components/github-sync/bottom-nav.tsx`

**UI**：Dashboard/Repos/Logs/Settings tabs（Dashboard 高亮）

**验收**：Mobile 显示正确

### Task 3.9: 整合布局

**文件**：
- `apps/web/src/routes/_index.tsx`（渲染 TopBar + GitHubSync + BottomNav）

**验收**：完整页面布局

---

## Cycle 4 — SAM 模板

### Task 4.1: VPC 网络

**文件**：
- `template.yaml`

**资源**：
- VPC（10.0.0.0/16）
- Internet Gateway
- 公有子网（10.0.0.0/24）+ NAT Gateway
- 私有子网 A（10.0.1.0/24）
- 私有子网 B（10.0.2.0/24）
- 路由表（公有 → IGW，私有 → NAT）

**验收**：`sam validate` 通过

### Task 4.2: 安全组

**资源**：
- LambdaSecurityGroup（egress 0.0.0.0/0）
- RdsSecurityGroup（ingress 5432 from Lambda）

**验收**：安全组规则正确

### Task 4.3: RDS PostgreSQL

**资源**：
- DBSubnetGroup（私有子网 A + B）
- DBInstance（postgres 15, db.t3.micro）
- SecretsManager（DB 凭据）

**验收**：RDS 配置正确

### Task 4.4: Lambda 函数

**资源**：
- Function（Hono API, VPC 配置）
- Environment（DATABASE_URL from Secrets Manager）

**验收**：Lambda 配置正确

### Task 4.5: API Gateway + S3/CloudFront

**资源**：
- HttpApi（触发 Lambda）
- S3 Bucket（前端静态文件）
- CloudFront Distribution（CDN）

**验收**：API + 前端托管配置正确

### Task 4.6: Outputs

**输出**：
- ApiUrl（API Gateway endpoint）
- WebUrl（CloudFront domain）

**验收**：`sam validate` 通过

---

## Cycle 5 — GitHub Actions

### Task 5.1: Workflow 文件

**文件**：
- `.github/workflows/deploy.yml`

**步骤**：
1. checkout
2. configure AWS credentials（OIDC）
3. pnpm install
4. pnpm build
5. sam build
6. sam deploy

**验收**：workflow 语法正确

### Task 5.2: IAM 配置文档

**文件**：
- `docs/aws-setup.md`

**内容**：
- 创建 IAM OIDC Provider
- 创建 IAM Role（信任 GitHub）
- 附加策略（SAM 部署权限）
- 配置 GitHub Secrets（`AWS_ROLE_ARN`）

**验收**：文档完整可执行

---

## Cycle 6 — 验证 + 文档

### Task 6.1: 本地端到端测试

**步骤**：
1. 启动 PostgreSQL
2. `pnpm db:push`
3. `pnpm dev:server`
4. `pnpm dev:web`
5. 访问 http://localhost:5173
6. 输入 PAT → Sync → 验证 Profile Card
7. Delete → 验证 Empty State

**验收**：完整流程无报错

### Task 6.2: README.md

**文件**：
- `README.md`

**内容**：
- 项目概述
- 技术栈
- 本地开发（pnpm install / dev）
- AWS 部署（sam deploy）
- 截图（UI + AWS 架构）

**验收**：文档完整

### Task 6.3: 部署文档

**文件**：
- `docs/deployment.md`

**内容**：
- AWS 前置条件（VPC、RDS、IAM）
- SAM 部署步骤
- GitHub Actions 配置
- 故障排查

**验收**：文档完整

---

## 任务依赖图

```
1.1 → 1.2 → 1.3 → 1.4 → 2.1 → 2.2, 2.3, 2.4 → 2.5
                                                ↓
                                         3.1 → 3.2-3.8 → 3.9
                                                ↓
                                         4.1-4.6 → 5.1-5.2 → 6.1-6.3
```
