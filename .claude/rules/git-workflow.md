---
description: Git 工作流规范
---

# Git Workflow

## 分支策略

- `main`：随时可部署
- feature 分支：`feat/feature-name`
- fix 分支：`fix/bug-description`
- 单人项目可直接 main，多人协作用 PR

## Commit 规范

格式：`type(scope): description`

类型：
- `feat` — 新功能
- `fix` — Bug 修复
- `chore` — 构建/配置/依赖
- `refactor` — 重构（无功能变化）
- `docs` — 文档
- `test` — 测试

示例：
```
feat(api): add task create procedure
fix(auth): pass raw headers to getSession
chore(deps): upgrade drizzle-orm
```

## 提交纪律

- 每次提交只做一件事（不混合 feature + fix + chore）
- 不提交 `.env`、`apps/server/.env`、`node_modules/`、构建产物（`dist/`）
- Drizzle 生成的 `packages/db/src/migrations/` **需要**提交
- `pnpm check-types` 通过后再提交

## 部署

- 本项目当前未配置部署（`web-deploy`/`server-deploy` 均为 none）。接入部署平台时：
  - 确认所有环境变量（`DATABASE_URL`、`BETTER_AUTH_*`、`CORS_ORIGIN`、`VITE_SERVER_URL`）已在平台配置
  - 部署前运行 `pnpm db:migrate`
  - 部署后验证 health 端点（`GET /` 返回 `OK`）与 `/api/auth/get-session`

## Monorepo 工作流（Turborepo + pnpm）

### 跨 package 改动

- 改动影响多个 package 时，在一个 commit 中提交所有相关变更（保持原子性）
- 示例：修改 `packages/db/src/schema/` 后同时更新 `packages/api/src/routers/` 和生成 migration
- Turborepo 自动追踪依赖关系，`turbo build` 会触发依赖 package 的构建

### Lock 文件管理

- `pnpm-lock.yaml` **必须提交**（防止依赖版本漂移，确保团队环境一致）
- 修改 `package.json` 后必须运行 `pnpm install` 更新 lock 文件
- 不要手动编辑 lock 文件（由 pnpm 自动维护）
- 升级依赖：`pnpm update <package>` → 验证构建 → 提交 lock 文件变更

### workspace 依赖

- 内部 package 用 `workspace:*`（如 `"@taskaws/db": "workspace:*"`）
- 发布到 npm 时替换为具体版本（当前项目不发布）
- 新增 package 时更新根 `package.json` 的 `workspaces` 数组

### Turborepo 缓存

- `.turbo/` 目录不提交（本地构建缓存，CI 可缓存以加速）
- 远程缓存（接入时）：`turbo login` + `turbo link`，CI 用 `--token` 接入

## 提交门禁（Codex Review Gate）

**所有 `git commit` 前自动触发 codex review，BLOCK 则拦截提交。**

本项目挂载双层 Review Gate：

| Hook | 触发时机 | 机制 |
|------|---------|------|
| `pre-commit-review.cjs` | `git commit` 执行前（PreToolUse） | 拦截 Bash 调用，BLOCK 则拒绝提交 |
| `codex-review-on-stop.cjs` | Claude 每次停止时（Stop） | 若工作区有未提交改动则审查，BLOCK 则阻止停止 |

两层互为补充：PreToolUse 是主门禁（在提交点直接把守）；Stop hook 是兜底（捕获遗漏的未提交改动）。

### 工作原理

- Hook 检查工作区是否有待提交改动（`git status --porcelain`）
- 有改动时调用本机 `codex` CLI 执行代码审查
- 审查结果为 BLOCK → 拦截提交，需修复问题后再次提交
- 审查结果为 PASS → 放行提交
- 未安装 `codex` CLI 时 hook 静默放行（不阻塞开发）

### 适用范围

- 所有工作流自动生效：`/gz:coding`、`/gz:wf`、手动 `git commit`
- 检查内容：代码质量、安全问题、架构规范、最佳实践
- 不检查：已提交的历史 commit（只审查待提交改动）

## .gitignore 规范（Better T Stack Monorepo）

### 必须忽略

- **依赖**：`node_modules/`、`.pnpm-store/`
- **构建产物**：`dist/`、`build/`、`*.tsbuildinfo`、`.turbo/`、`.nx/`
- **环境变量**：`.env`、`.env*.local`、`apps/server/.env`（密钥绝不上库）
- **生成文件**：`apps/web/src/routeTree.gen.ts`（React Router 自动生成）
- **AI 工作流临时文件**：`codex-review/`、`.claude/workflow-visualizer/`、`.claude/settings.local.json`

### 必须提交

- `pnpm-lock.yaml`（依赖锁定）
- `packages/db/src/migrations/`（Drizzle migration 文件）
- `.claude/CLAUDE.md`、`.claude/rules/`（团队共享规范）
- `.claude/settings.json`（项目级 Claude 配置，不含密钥）
- `turbo.json`（构建管道配置）

### 可选提交

- `.vscode/settings.json`（团队共享编辑器配置）
- `.vscode/extensions.json`（推荐扩展列表）

## Git Hooks

### PreToolUse Hook（.claude/hooks/pre-commit-review.cjs）

- 在 Claude 调用 Bash 执行 `git commit` 前拦截
- 检查待提交改动，调用 codex review
- 返回 BLOCK → Claude 取消 Bash 调用，提交被拒绝
- 返回 PASS → Claude 继续执行 git commit

### Stop Hook（.claude/hooks/codex-review-on-stop.cjs）

- Claude 每次停止时触发（包括任务完成、用户中断）
- 检查工作区是否有未提交改动
- 有改动则自动审查，BLOCK 则阻止停止（强制修复问题）
- 无改动或 PASS → 正常停止

### Hook 配置

- Hook 定义在 `.claude/hooks/` 目录
- 通过 `.claude/settings.json` 的 `hooks` 字段激活
- 依赖本机安装 `codex` CLI（未安装时静默放行）

## Merge/Rebase 策略

- **单人项目**：直接在 `main` 上开发，提交前确保 `pnpm check-types` 通过
- **多人协作**：
  - feature 分支开发完成后 PR 合并到 `main`
  - 合并前 PR 必须通过 CI（类型检查、测试）
  - 优先用 **merge commit**（保留完整历史），避免 rebase（monorepo 跨 package改动易产生冲突）
  - 冲突解决：在本地 feature 分支 `git merge main` → 手动解决 → 推送 → 合并 PR

## Commit 检查清单

提交前确认：

1. **类型检查**：`pnpm check-types` 通过（零错误）
2. **依赖锁定**：改了 `package.json` → `pnpm install` → `pnpm-lock.yaml` 已更新
3. **Migration**：改了 `packages/db/src/schema/` → `pnpm db:generate` → migration 文件已生成
4. **环境变量**：未提交 `.env` / `apps/server/.env`（已在 `.gitignore`）
5. **敏感信息**：未在代码中硬编码密钥/连接串/密码
6. **Monorepo 原子性**：跨 package 改动在一个 commit 中提交
7. **Review Gate**：codex review 通过（未返回 BLOCK）

## 常见问题

### 依赖版本冲突

- `pnpm-lock.yaml` 不一致 → 删除 lock 文件 → `pnpm install` 重新生成
- workspace 依赖找不到 → 检查 `package.json` 的 `workspaces` 配置

### Migration 未提交

- Drizzle migration 必须提交（其他开发者/CI 需要运行 `pnpm db:migrate`）
- schema 变更后忘记生成 → `pnpm db:generate` → 提交 `packages/db/src/migrations/` 新文件

### Codex Review Block

- Review 返回 BLOCK → 查看审查意见 → 修复问题 → 再次提交
- 常见 BLOCK 原因：类型错误、安全漏洞、硬编码密钥、缺少 zod 校验

### Turborepo 缓存未生效

- CI 构建慢 → 接入 Turborepo 远程缓存（`turbo login` + `turbo link`）
- 本地缓存丢失 → `.turbo/` 不提交，CI 可持久化缓存目录
