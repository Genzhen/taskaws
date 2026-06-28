# LESSONS.md — 开发踩坑与教训

记录开发中遇到的问题与解决方案，持续追加形成自学习闭环。

---

## 2026-06-28: Codex Review P1/P2 Issues

### L1: Vite 客户端环境变量前缀陷阱

**问题**：`packages/env/src/web.ts` 改用 `(import.meta as any).env.SKIP_ENV_VALIDATION`，但 Vite 只暴露 `VITE_` 前缀变量到 `import.meta.env`。

**原因**：混淆了 Node.js `process.env` 与 Vite `import.meta.env` 的访问方式。

**修复**：web.ts 应继续使用 `process.env.SKIP_ENV_VALIDATION`（build/test 环境是 Node.js，process.env 可用）。

**教训**：
- Vite 客户端代码中，只有 `VITE_` 前缀的环境变量会暴露到 `import.meta.env`
- 非 `VITE_` 前缀变量（如 `SKIP_ENV_VALIDATION`）即使在 build/test 时也需要通过 `process.env` 访问
- server.ts（Node.js）→ `process.env`，web.ts（build/test）→ 也是 `process.env`，运行时客户端 → `import.meta.env.VITE_*`

---

### L2: 多字段 unique 约束的 upsert 冲突处理

**问题**：`github_profiles` 表有两个 unique 约束（`userId` + `githubId`），但 `upsertByUserId` 只处理 userId 冲突，导致第二个用户同步同一 GitHub account 时触发 `githubId` unique 约束错误。

**原因**：只考虑了自身字段的 upsert，忽略了关联字段的 unique 约束。

**修复**：在 upsert 前检查 `githubId` 是否已被其他用户绑定，若冲突则抛出用户友好的验证错误。

**教训**：
- 表有多字段 unique 约束时，upsert 必须检查所有约束是否会产生冲突
- 不能只依赖 `onConflictDoUpdate` 的单一 target，需在业务层主动检查
- 冲突检查逻辑：查询是否存在 → 判断是否属于当前用户 → 决定 upsert 或拒绝

---

### L3: 无效的 npm script（命令依赖缺失）

**问题**：添加 `sam:build` script 但没有 `template.yaml`，命令无法运行。

**原因**：盲目添加 AWS SAM 相关命令，未确认依赖文件是否存在。

**修复**：移除无效的 script，待将来接入 SAM 时再添加完整配置。

**教训**：
- 新增 npm script 前必须确认依赖文件/工具已存在
- 不应添加无法运行的命令（误导用户）
- 大型依赖（如 AWS SAM）应独立 issue/PR，包含完整配置后再添加 script

---

---

## 2026-06-28: Codex Review Round 2 — GitHub Sync UX & Security

### L4: 认证后导航路径不一致

**问题**：新的 GitHub Sync 功能在首页（`_index.tsx`），但登录/注册成功后仍然跳转到 `/dashboard`，用户在正常流程中无法看到新功能。

**原因**：添加新功能时未同步更新认证成功回调的重定向路径。

**修复**：将登录/注册表单的 `onSuccess` 重定向改为 `/`（首页）而不是 `/dashboard`。

**教训**：
- 新增核心功能时，必须检查用户到达该功能的完整路径（包括认证后重定向）
- 认证成功的 callback URL 应指向新的"主页"，而不是旧的 dashboard
- 测试完整用户旅程：注册 → 登录 → 重定向 → 是否能看到新功能？

---

### L5: 同步成功后未清除敏感凭证（PAT）

**问题**：GitHub PAT 在同步成功后仍保留在组件状态和输入框中，共享屏幕/空闲会话时可被恢复查看。

**原因**：只在 delete 操作中清除 PAT，未在 sync 成功后清除。

**修复**：在 `syncMutation.onSuccess` 中添加 `setPat("")`，成功后立即清除。

**教训**：
- 敏感凭证（PAT、API Key）只在请求发起时需要，成功后应立即清除
- 不要让敏感数据在 UI 中"残留"（即使已发送到后端）
- 清除时机：请求成功、组件卸载、页面刷新前

---

### L6: 外部 API 请求无 timeout 保护

**问题**：`fetch("https://api.github.com/user")` 无 timeout 或 abort signal，GitHub 响应慢时会挂起整个请求直到 server/Lambda timeout。

**原因**：直接 fetch 未设置超时，依赖系统默认超时（可能很长）。

**修复**：使用 `AbortController` + `setTimeout(10s)`，超时后 abort 并抛出 `TRPCError({ code: "TIMEOUT" })`。

**教训**：
- 所有外部 API 请求必须设置 timeout（推荐 5-15 秒）
- 使用 `AbortController` 实现可控的请求取消
- try-catch-finally 结构：catch AbortError → throw TIMEOUT error → finally 清除 timeout
- timeout 时间根据 API 特性调整（GitHub API 推荐 10 秒）

---

---

## 2026-06-28: Codex Review Round 3 — Navigation Regression

### L7: 隐藏 Header 导致用户无法登出

**问题**：首页（`/`）隐藏了全局 Header（避免重复），但 Header 包含 UserMenu 和 sign-out 操作，导致登录后跳转到首页的用户无法在 UI 中登出或导航。

**原因**：首页有自己的 TopBar，但 TopBar 只显示用户头像和通知图标，没有 sign-out 按钮。

**修复**：在 TopBar 右侧添加 LogOut 按钮，点击后调用 `authClient.signOut()` 并 navigate 到 `/login`。

**教训**：
- 隐藏全局导航组件时，必须在替代组件中提供相同的导航/登出能力
- 用户旅程中必须始终有可见的登出口（sign-out button）
- 检查"特殊 layout"是否保留了核心功能（导航、登出、设置）
- 测试完整流程：登录 → 首页 → 是否能看到 sign-out → 点击是否能登出

---

---

## 2026-06-28: Codex Review Round 4 — Error Handling & SPA Redirect

### L8: Writer 抛普通 Error 导致客户端无 actionable 错误

**问题**：`githubWriter` 在检测到 GitHub account 已被绑定时抛出 `Error`，tRPC 将其转换为 `INTERNAL_SERVER_ERROR`，客户端收到 generic failure 而不是 actionable "account already linked" 消息。

**原因**：在 DB writer 中使用普通 `Error` 而不是 `TRPCError`。

**修复**：改为 `throw new TRPCError({ code: "CONFLICT", message: "..." })`，让前端能识别业务规则冲突并显示对应提示。

**教训**：
- tRPC procedure 中的业务规则冲突必须用 `TRPCError`，不能用普通 `Error`
- Error code 应映射业务语义：`CONFLICT`（重复）、`BAD_REQUEST`（参数错误）、`FORBIDDEN`（权限不足）
- DB writer/reader 被 tRPC procedure 调用时，应抛出 tRPC 兼容的错误类型

---

### L9: useEffect redirect 导致 SPA 空白页面

**问题**：首页在 `useEffect` 中 redirect 未登录用户，导致直接访问 `/` 或刷新时短暂显示空白页面（hydration 后才 redirect）。如果 JS 加载失败，redirect 永远不发生。

**原因**：SPA 模式下，`useEffect` 是异步执行的（mount 后），render 时先返回 `null`。

**修复**：改为同步检查（render 时）：`if (!isPending && !session) { navigate("/login", { replace: true }); return <Redirecting...>; }`

**教训**：
- SPA 路由保护必须在 render 时同步检查，不能依赖 `useEffect`（异步）
- `useEffect` 适合 side effects（日志、revalidation），不适合关键 redirect
- 未登录重定向流程：同步检查 → navigate → 显示 redirecting 状态 → 目标页面
- React Router SPA 模式下，`navigate()` 可在 render 时调用（但会触发 state 更新）

---

---

## 2026-06-28: Codex Review Round 5 — React Hooks & Concurrency

### L10: Early return 导致 React hook order violation

**问题**：在 `useSession()` settle 后的 early return branch（redirect）跳过了 `useEffect` hook，但之前的 render（`isPending` 时）调用了所有 hooks，导致 hook order 不一致，触发 React "Rendered fewer hooks than expected" crash。

**原因**：React hook 规则要求每次 render 的 hook call order 必须一致，early return 会跳过后续 hooks。

**修复**：使用 `<Navigate to="/login" replace />` component（declarative redirect）代替 `navigate()` + early return，Navigate 不跳过 hooks。

**教训**：
- **React hook order 规则**：hooks 调用顺序必须在每次 render 保持一致（即使 branch 不同）
- Early return 在 hooks 之后可以，但不能在 hooks 之前或中间
- React Router 的 `<Navigate>` component 是 declarative redirect（不 break hook order）
- `navigate()` imperative call 可以在 render 时使用，但必须确保所有 hooks 都已调用

---

### L11: DB pre-check 在并发场景下的 race condition

**问题**：两个用户并发 sync 同一 GitHub account，pre-check 都观察到 no existing row，然后都 insert，一个成功一个失败（hit `github_id` unique constraint），失败用户收到 500 而不是 CONFLICT。

**原因**：Pre-check + insert 不是原子操作，并发时存在 window。

**修复**：用 `db.transaction()` 包裹 check + insert，并 catch unique violation error 转换为 `TRPCError(CONFLICT)`。

**教训**：
- **并发安全**：pre-check + upsert 必须在事务中（原子操作）
- Unique constraint violation（PostgreSQL error 23505）应 catch 并转换为业务错误
- 事务 + try-catch 是处理并发冲突的标准模式：
  ```typescript
  try {
    await db.transaction(async (tx) => { check + upsert });
  } catch (error) {
    if (isUniqueViolation(error)) throw TRPCError(CONFLICT);
    throw error; // Re-throw other errors
  }
  ```

---

---

## 2026-06-28: Codex Review Round 6 — PostgreSQL Syntax Error

### L12: Migration 文件使用了不支持的 PostgreSQL syntax

**问题**：`ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS` 不是有效的 PostgreSQL syntax，导致 `db:migrate` 在 fresh database 上失败，GitHub profile table 无法创建。

**原因**：Drizzle-kit 生成的 migration 文件包含了 `IF NOT EXISTS`，但 PostgreSQL 不支持此语法（MySQL 支持）。

**修复**：移除 `IF NOT EXISTS`，直接用 `ALTER TABLE ... ADD CONSTRAINT`。

**教训**：
- **PostgreSQL syntax 检查**：`ADD CONSTRAINT` 不支持 `IF NOT EXISTS`（PostgreSQL 限制）
- Drizzle migration 文件必须人工 review，确保 syntax 符合目标数据库
- Migration 文件是 release-blocking，任何 syntax error 会阻止整个功能上线
- PostgreSQL 安全语法：
  - ✅ `CREATE TABLE IF NOT EXISTS`
  - ✅ `CREATE INDEX IF NOT EXISTS`
  - ❌ `ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS`
- 解决方案：直接 `ADD CONSTRAINT`（重复运行 migration 会报错，但这是预期行为）

---

---

## 2026-06-28: Codex Review Round 7 — Cross-Account Data Leak

### L13: Sign-out 未清除 React Query cache 导致跨用户数据泄露

**问题**：sign-out 时没有清除 React Query cache，下一个用户登录后可能短暂看到上一个用户的 avatar/profile（直到 refetch 完成）。这是 cross-account data leak，属于安全漏洞。

**原因**：`trpc.privateData` 和 `trpc.github.getProfile` 使用 user-agnostic keys，cache 不自动区分用户。

**修复**：在 sign-out `onSuccess` 中调用 `queryClient.clear()` 清除所有缓存。

**教训**：
- **安全原则**：sign-out 必须清除所有用户相关缓存（React Query、localStorage、sessionStorage）
- React Query cache 是全局的（不自动按用户隔离），sign-out 后必须手动清理
- Cross-account data leak 是 P1 security issue：
  - 用户 A sign-out → 用户 B sign-in → 用户 B 看到用户 A 的数据
  - 可能暴露敏感信息（profile、privateData、settings）
- 标准 sign-out 流程：
  ```typescript
  authClient.signOut({
    fetchOptions: {
      onSuccess: () => {
        queryClient.clear(); // Clear React Query cache
        localStorage.clear(); // Clear localStorage (if any user data)
        navigate("/login");
      },
    },
  });
  ```

---

---

## 2026-06-28: Codex Review Round 8 — Functional UX Issues

### L14: PAT trim 检查但提交未 trim

**问题**：`handleSync` 检查 `pat.trim()` 是否为空，但提交时发送的是未 trim 的 `pat`，导致 clipboard whitespace（换行/空格）让 valid PAT 失败。

**原因**：检查逻辑和提交逻辑不一致（check trim, submit raw）。

**修复**：存储 `trimmedPat` 变量，检查后提交 trimmed version：`const trimmedPat = pat.trim(); if (!trimmedPat) { ... } syncMutation.mutate(trimmedPat);`

**教训**：
- 输入验证逻辑必须与提交逻辑一致（不能 check trim 但 submit raw）
- Clipboard paste 的 PAT 可能带 whitespace（换行、空格），必须 trim 后使用
- 标准 pattern：先 trim → 检查 → 提交 trimmed value

---

### L15: Sync 和 Delete 并发 race condition

**问题**：用户点击 sync（开始 resync）→ 在 sync 进行时点击 delete → delete 完成 → sync 完成（recreate row）→ UI 显示 "deleted" 但 DB 中 profile 又回来了。

**原因**：Delete button 只在 `deletePending` 时 disabled，sync 进行时 delete button 仍然 enabled。

**修复**：传递 `deleteDisabled={syncMutation.isPending || deleteMutation.isPending}` 给 ProfileCard，sync 和 delete 同时禁用。

**教训**：
- **并发操作互斥**：sync + delete 是互斥操作（delete 会删除 sync 的目标）
- 两个 mutation 同时进行会导致不一致状态（delete 成功但 sync recreate）
- UI 状态管理：一个 mutation in flight 时，相关 mutation button 都应 disabled
- Pattern：`const deleteDisabled = mutation1.isPending || mutation2.isPending;`

---

### L16: Mobile bottom-nav 无导航误导用户

**问题**：Bottom-nav buttons 渲染为 `<button>` 但无 onClick/Link，用户点击看到 hover/active 样式但无法导航，UI 是 misleading（暗示功能存在但实际不存在）。

**原因**：添加了 UI skeleton（nav buttons）但未实现导航逻辑。

**修复**：添加 onClick handler，Dashboard 无操作（当前页），其他 tabs 显示 `toast.info("Coming soon")` 避免 misleading。

**教训**：
- **UI affordance 诚实原则**：如果没有实现功能，不应渲染可交互的 UI（或明确提示"Coming soon"）
- Buttons 必须有 onClick handler（即使只是 placeholder message）
- 不应让用户点击后发现 "nothing happens"（misleading UX）
- Placeholder UI：onClick + toast 提示（"功能未实现"）或直接隐藏按钮

---

---

## 2026-06-28: Codex Review Round 9 — Deployment Blocking Issues

### L17: Turbo task 未定义导致 root script 无法运行

**问题**：添加了 root `pnpm build:api` script 但 `turbo.json` 没有 `build:api` task，运行时报错 "Could not find task build:api in project"。

**原因**：Turbo 根 scripts 必须在 `turbo.json` 中定义对应的 task 才能通过 `-F <package>` 调用 workspace script。

**修复**：在 `turbo.json` 添加 `"build:api": { "dependsOn": ["^build"], "outputs": ["dist/**"] }`。

**教训**：
- **Turbo task 配置**：root package.json script → turbo.json task 必须同步
- Turbo 通过 task name 调用 workspace script（不是直接调用 package script）
- 新增 root script 时必须检查 turbo.json 是否已定义对应 task
- 配置 pattern：
  ```json
  // package.json
  "scripts": { "build:api": "turbo -F server build:api" }
  
  // turbo.json
  "tasks": { "build:api": { "dependsOn": ["^build"], "outputs": ["dist/**"] } }
  ```

---

### L18: Baseline migration 重新添加已存在的 FK constraints

**问题**：`0000_noisy_mole_man.sql` 包含完整的 auth tables baseline，对于已通过 `db:push` 创建 auth tables 的环境，`db:migrate` 会失败在 duplicate FK constraint errors（`account_user_id_user_id_fk` 已存在）。

**原因**：Baseline migration 不区分 fresh database 和已初始化 database，无条件执行 `ALTER TABLE ADD CONSTRAINT`。

**修复**：使用 PostgreSQL DO block conditional check：
  ```sql
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'xxx') THEN
      ALTER TABLE ... ADD CONSTRAINT ...;
    END IF;
  END $$;
  ```

**教训**：
- **Migration baseline 兼容性**：已初始化环境 + fresh environment 都必须能运行
- PostgreSQL 不支持 `ADD CONSTRAINT IF NOT EXISTS`（必须用 DO block workaround）
- Conditional constraint add pattern：
  ```sql
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'constraint_name') THEN
      ALTER TABLE table ADD CONSTRAINT constraint_name FOREIGN KEY ...;
    END IF;
  END $$;
  ```
- Drizzle migration 文件需人工 review，确保兼容已存在环境
- Baseline vs delta：最好将 baseline 和 delta 分离（baseline 标记已 applied）

---

---

## 2026-06-28: Codex Review Round 10 — Mutually Exclusive Mutations (Revised)

### L19: Sync button 未在 delete pending 时 disabled（race condition incomplete fix）

**问题**：之前只让 delete button 在 sync pending 时 disabled，但 sync button 在 delete pending 时仍 enabled，导致 delete 进行中用户可点击 sync，两者并发 race（delete 成功 → sync recreate → UI 显示 deleted 但 DB 中 profile 又存在）。

**原因**：Mutual exclusion 不完整（单向禁用，未双向禁用）。

**修复**：
- `syncDisabled = syncState === "loading" || deleteMutation.isPending`
- `deleteDisabled = syncMutation.isPending || deleteMutation.isPending`

**教训**：
- **双向互斥原则**：sync ↔ delete 必须双向禁用（一个进行时，另一个必须 disabled）
- Single-direction disable 不够（只防一边，另一边仍可并发）
- 标准 pattern（双向互斥）：
  ```typescript
  const operation1Disabled = operation1.isPending || operation2.isPending;
  const operation2Disabled = operation1.isPending || operation2.isPending;
  ```
- UI state 管理审查：检查所有 mutation pair 是否双向禁用（不是单向）

---

## 总结原则（追加）

19. **双向互斥 mutation**：sync ↔ delete 必须双向 disabled（不能单向）

---