# Tasks: GitHub Sync RW (AWS 读写分离)

**依赖图**:`T1+T3+T11+T12`(并行) → `T2` → `T4+T5+T6`(并行) → `T7+T8+T9`(并行) → `T10` → `T13` → `T14` → `T15`

**工种**:`database` / `backend` / `frontend` / `qa`

**验收标准**:`pnpm check-types` 通过 + `biome check`(如有)通过 + 对应 AC 通过

---

## Group A — 无依赖(并行)

### Task T1: env 变量改造 (database)

**目标**:`packages/env/src/server.ts` 支持双数据库 URL

**文件**:
- `packages/env/src/server.ts`

**改动**:
```typescript
// 旧
DATABASE_URL: z.string().min(1),

// 新(并存兼容,避免一次性打挂所有引用)
DATABASE_URL: z.string().min(1).optional(),             // 保留作 fallback
DATABASE_WRITER_URL: z.string().url(),                  // 必填
DATABASE_READER_URL: z.string().url(),                  // 必填
```

**验收**:
- `.env` 中已有 `DATABASE_WRITER_URL` 与 `DATABASE_READER_URL`(已配置)
- `packages/env` 编译通过
- 服务端启动时不再报 `DATABASE_URL` 缺失(若完全删除旧字段)或仍可用 fallback

**估时**:5 分钟

---

### Task T3: schema 重设计 (database)

**目标**:新建 `github_users` 表(替换 `github_profiles`)

**文件**:
- `packages/db/src/schema/github.ts`(重写)
- `packages/db/src/schema/index.ts`(re-export 更新)
- `packages/db/src/schema/auth.ts`(保留 user 表,但不再被 github schema 引用)

**改动**:`github.ts` 改为 design.md 3.1 节定义:
- 表名 `github_users`
- 字段:`id uuid PK`、`github_id int UNIQUE`、`username varchar(255)`、`avatar_url text`、`bio text nullable`、`public_repos int default 0`、`updated_at timestamp defaultNow + $onUpdate`
- 移除 `userId` 字段与 `user` import
- 移除 `githubProfilesRelations`

`index.ts`:
```typescript
export * from "./auth";
export * from "./github"; // 现在导出的是 githubUsers
```

**验收**:
- `packages/db` 编译通过
- `pnpm check-types` 在 packages/db 通过
- 旧 `githubProfiles` 与 `githubProfilesRelations` 完全移除

**估时**:10 分钟

---

### Task T11: TokenInput + SyncButton 组件 (frontend)

**目标**:PAT 输入 + 同步按钮(含 loading 态)

**文件**:
- `apps/web/src/components/github-sync/token-input.tsx`(新建)
- `apps/web/src/components/github-sync/sync-button.tsx`(新建)
- `apps/web/src/components/github-sync/index.ts`(barrel export,新建)

**UI 规格**:
- **TokenInput**:
  - Label: "GitHub Personal Access Token"
  - Input: `type="password"` + 右侧 eye icon 切换 visibility
  - Placeholder: "ghp_xxxx 或 github_pat_xxxx"
  - Hint 文案: "Token 需要 read:user 权限"
  - 受控:`value` + `onChange` props
  - disabled 态:Sync 进行中时禁用
- **SyncButton**:
  - idle: 主色背景(blue),文案 "开始同步"
  - loading: spinner + "Syncing..."
  - disabled: Sync 进行中 / token 为空
  - 使用 `@taskaws/ui` 的 Button 组件作基础(若有),或直接用 `<button>` + tailwind

**依赖组件库**:
- `lucide-react` 的 `Eye` / `EyeOff` / `Loader2` 图标
- tailwind utility: `flex items-center gap-2 px-4 py-2 rounded-md`

**验收**:
- 单独 story 或页面渲染正常
- loading 态切换流畅
- tailwind 类名符合 design token(用 `bg-primary text-primary-foreground` 等变量)

**估时**:20 分钟

---

### Task T12: ProfileCard + EmptyState 组件 (frontend)

**目标**:已同步用户展示 + 未同步占位

**文件**:
- `apps/web/src/components/github-sync/profile-card.tsx`(新建)
- `apps/web/src/components/github-sync/empty-state.tsx`(新建)

**类型**(新建 `apps/web/src/components/github-sync/types.ts`):
```typescript
export type GithubUser = {
  id: string;
  github_id: number;
  username: string;
  avatar_url: string;
  bio: string | null;
  public_repos: number;
  updated_at: string; // ISO 8601
};
```

**UI 规格**:
- **ProfileCard**:
  - 头像:`<img src={avatar_url} width={64} height={64} className="rounded-full" />`
  - `@username`(等宽字体)
  - bio(若为空显示 "No bio provided")
  - 公开仓库 chip:图标 + `{public_repos} repos`
  - 同步时间:`Updated {formatDistanceToNow(new Date(updated_at))} ago`(用 `date-fns` 或手写相对时间)
  - "擦除云端数据" 按钮:红色背景、danger 变体、点击弹 confirm(原生 `window.confirm` 即可)
- **EmptyState**:
  - Ghost 图标(`lucide-react` 的 `Ghost` 或 `Database` + 问号)
  - 虚线边框卡片
  - 文案: "尚未同步任何 GitHub 数据,输入 PAT 开始同步"

**验收**:
- ProfileCard 渲染 mock 数据正确
- EmptyState 静态展示正确
- 类型导出被 T13 使用

**估时**:20 分钟

---

## Group B — 依赖 Group A

### Task T2: 读写分离 DB 客户端 (database)

**目标**:创建 `dbWrite` + `dbRead` 双 Drizzle 实例

**文件**:
- `packages/db/src/index.ts`(重写)

**改动**:见 design.md 4.1 节
- import `Pool` from `pg`
- `writerPool = new Pool({ connectionString: env.DATABASE_WRITER_URL, max: 10 })`
- `readerPool = new Pool({ connectionString: env.DATABASE_READER_URL, max: 20 })`
- `dbWrite = drizzle(writerPool, { schema })`
- `dbRead = drizzle(readerPool, { schema })`
- 保留 `export const db = dbWrite` 作兼容(其他包可能还引用)

**依赖**:T1(env 校验),T3(schema 文件,编译期用;运行时不影响)
**验收**:
- `packages/db` 编译通过
- 服务端启动时成功连接两个 Pool(看 Hono logger 或手动 `console.log` 验证后移除)
- `writerPool` 与 `readerPool` 都暴露为命名导出(便于测试)

**估时**:15 分钟

---

## Group C — 依赖 T2 + T3(并行)

### Task T4: 生成 migration (database)

**目标**:生成 `github_users` 表的 migration,清理旧 `github_profiles`

**文件**:
- `packages/db/src/migrations/xxxx_github_users.sql`(由 drizzle-kit 生成)

**命令**:
```bash
cd packages/db
pnpm db:generate
```

**验收**:
- 生成的 SQL 包含 `DROP TABLE IF EXISTS github_profiles`
- 生成的 SQL 包含 `CREATE TABLE github_users (...)` 与 `CREATE UNIQUE INDEX github_users_github_id_idx`
- 在 Writer Endpoint 上执行 `pnpm db:migrate` 成功
- 用 `psql` 或 Drizzle Studio 验证表结构

**估时**:10 分钟

---

### Task T5: Reader 终节点重写 (database)

**目标**:按 `github_id` 查询,走 `dbRead`

**文件**:
- `packages/db/src/github/reader.ts`(重写)
- `packages/db/src/github/index.ts`(barrel 不变)

**改动**:见 design.md 4.2 节
- `githubReader.getByGithubId(githubId: number)` 用 `dbRead` 查询
- 移除旧的 `getByUserId`

**验收**:
- `packages/db` 编译通过
- 导出 `githubReader` 命名
- 类型推断正确(`GithubUser | null` 返回)

**估时**:10 分钟

---

### Task T6: Writer 终节点重写 (database)

**目标**:按 `github_id` upsert + delete,走 `dbWrite`

**文件**:
- `packages/db/src/github/writer.ts`(重写)

**改动**:见 design.md 4.3 节
- `githubWriter.upsertByGithubId(input)` 用 `ON CONFLICT (github_id) DO UPDATE`
- `githubWriter.deleteByGithubId(githubId)` 用 `DELETE WHERE github_id = ?`
- 移除旧的 `upsertByUserId` 与 `deleteByUserId`

**验收**:
- `packages/db` 编译通过
- `UpsertGithubUserInput` 类型导出
- upsert 在冲突时只更新数据字段,不覆盖 `id` / `createdAt`

**估时**:15 分钟

---

## Group D — 依赖 T5 + T6(并行)

### Task T7: POST /api/github/sync 路由 (backend)

**目标**:接收 PAT → 调 GitHub API → upsert

**文件**:
- `apps/server/src/routes/github.ts`(新建)

**实现**:见 design.md 5.1 节
- `c.req.json()` 解析 `{ github_token: string }`(zod 校验)
- `fetch("https://api.github.com/user", { headers: { Authorization: "token <pat>", Accept: "application/vnd.github+json", "User-Agent": "TaskAWS/1.0" }, signal: AbortSignal.timeout(10_000) })`
- 非 2xx → 400 `{ error: "Invalid GitHub token", code: "INVALID_PAT" }`
- 提取字段 → `githubWriter.upsertByGithubId(...)`
- 返回 200 + profile

**验收**:
- `curl -X POST http://localhost:3000/api/github/sync -H 'Content-Type: application/json' -d '{"github_token":"valid_pat"}'` 返回 200 + profile
- 错误 PAT 返回 400
- 后端日志可见 GitHub API 调用耗时

**估时**:25 分钟

---

### Task T8: GET /api/github/user/:github_id 路由 (backend)

**目标**:按 `github_id` 读,走 `dbRead`

**文件**:
- `apps/server/src/routes/github.ts`(追加)

**实现**:
- Path 参数 `github_id` 用 `z.coerce.number().int().positive()` 校验
- `githubReader.getByGithubId(githubId)`
- null → 404 `{ error: "User not found", code: "NOT_FOUND" }`
- 否则 200 + profile

**验收**:
- `curl http://localhost:3000/api/github/user/583231` 返回 200 + profile(若存在)
- 不存在返回 404
- 非法 github_id(负数 / 非数字)返回 400

**估时**:10 分钟

---

### Task T9: DELETE /api/github/user/:github_id 路由 (backend)

**目标**:按 `github_id` 物理删除,走 `dbWrite`

**文件**:
- `apps/server/src/routes/github.ts`(追加)

**实现**:
- Path 参数校验同 T8
- `githubWriter.deleteByGithubId(githubId)` → 看返回 `deleted` 字段
- `deleted: false` → 404;否则 200 `{ success: true }`

**验收**:
- `curl -X DELETE http://localhost:3000/api/github/user/583231` 返回 200
- 再次 GET 同 id 返回 404

**估时**:10 分钟

---

## Group E — 依赖 T7-T9

### Task T10: 注册路由 + 错误处理 (backend)

**目标**:把 `/api/github/*` 路由挂到 Hono app,加 `onError` 兜底

**文件**:
- `apps/server/src/index.ts`(修改)

**改动**:
```typescript
import { githubRoutes } from "./routes/github";

const app = new Hono();

// 现有 middleware
app.use(logger());
app.use("/*", cors({ origin: env.CORS_ORIGIN, credentials: true, ... }));
app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw)); // 保留

// 新路由
app.route("/api/github", githubRoutes);

// 兜底错误处理
app.onError((err, c) => {
  console.error("[unhandled]", err);
  return c.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, 500);
});

// 404
app.notFound((c) => c.json({ error: "Not found", code: "NOT_FOUND" }, 404));
```

**验收**:
- 三个路由都能通过 `http://localhost:3000/api/github/*` 访问
- 未捕获异常返回 500 + 标准格式,不泄露堆栈
- 不存在路径返回 404 + 标准格式

**估时**:15 分钟

---

## Group F — 依赖 T10 + T11 + T12

### Task T13: GitHubSync 主容器 (frontend)

**目标**:组合 T11/T12 组件,实现状态机 + 调 REST API

**文件**:
- `apps/web/src/components/github-sync/github-sync.tsx`(新建)

**状态**:
```typescript
type State =
  | { kind: "idle" }
  | { kind: "syncing" }
  | { kind: "profile"; user: GithubUser }
  | { kind: "deleting" };
```

**逻辑**:
- 挂载时:可选 `GET /api/github/user/<last_known_id>`(若 localStorage 有缓存 id)
- "开始同步" 按钮点击:
  1. 状态 → syncing
  2. `POST /api/github/sync` with `{ github_token }`
  3. 成功 → 状态 → profile(user 来自响应,不必再 GET)
  4. 失败 → toast 错误,状态 → idle
- "擦除云端数据" 按钮点击:
  1. `window.confirm("确定要擦除云端数据?此操作不可恢复")`
  2. 状态 → deleting
  3. `DELETE /api/github/user/<github_id>`
  4. 成功 → 状态 → idle
  5. 失败 → toast 错误,状态 → profile

**fetch 封装**(可单独文件 `apps/web/src/components/github-sync/api.ts`):
```typescript
const SERVER_URL = env.VITE_SERVER_URL; // e.g. http://localhost:3000

export async function syncGithubUser(token: string): Promise<GithubUser> {
  const res = await fetch(`${SERVER_URL}/api/github/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ github_token: token }),
  });
  if (!res.ok) {
    const err = await res.json() as { error: string };
    throw new Error(err.error);
  }
  return res.json() as Promise<GithubUser>;
}

export async function deleteGithubUser(githubId: number): Promise<void> {
  const res = await fetch(`${SERVER_URL}/api/github/user/${githubId}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    const err = await res.json() as { error: string };
    throw new Error(err.error);
  }
}
```

**验收**:
- 完整状态机切换正确
- 错误 toast 提示清晰(用 `sonner` 的 `toast.error`)
- Loading 态下输入 / 按钮禁用
- 类型推断无 any

**估时**:40 分钟

---

## Group G — 依赖 T13

### Task T14: 路由注册 (frontend)

**目标**:把 GitHubSync 页面挂到 React Router

**文件**:
- `apps/web/src/routes/github-sync.tsx`(新建,default export)
- `apps/web/src/routes.ts`(或 `routes.ts` 自动生成,添加新 route)

**实现**:
```tsx
// github-sync.tsx
import { GitHubSync } from "~/components/github-sync";

export default function GithubSyncPage() {
  return (
    <main className="min-h-screen bg-background">
      <GitHubSync />
    </main>
  );
}
```

**路由配置**:根据 `@react-router/fs-routes` 约定,文件名 `github-sync.tsx` 自动映射到 `/github-sync` 路径。需在 `routes.ts` 显式声明(若未用 fs-routes)。

**验收**:
- 访问 `http://localhost:5173/github-sync` 显示页面
- `pnpm check-types` 在 `apps/web` 通过

**估时**:10 分钟

---

## Group H — 依赖 T14

### Task T15: 端到端验证 (qa)

**目标**:验证所有 AC 通过

**步骤**:
1. 启动后端:`pnpm dev:server`(port 3000)
2. 启动前端:`pnpm dev:web`(port 5173)
3. 浏览器访问 `http://localhost:5173/github-sync`
4. 输入有效 PAT → 点"开始同步" → Loading → ProfileCard 显示
5. 验证 DB:`psql $DATABASE_WRITER_URL -c 'SELECT * FROM github_users;'`
6. 点"擦除云端数据" → confirm → 回到 EmptyState
7. 验证 DB 已清空
8. 输入无效 PAT → 应 toast 错误,数据库无新增
9. 直接 curl 三个接口,验证返回格式

**验收**:
- AC-1 ~ AC-6 全部通过
- `pnpm check-types` 全 monorepo 通过
- 无 console error(前端 / 后端)

**估时**:30 分钟

---

## 任务依赖图

```
Group A (并行)
┌──────┬──────┬──────┬──────┐
│  T1  │  T3  │  T11 │  T12 │
└──┬───┴──┬───┴──┬───┴──┬───┘
   │      │      │      │
   ▼      │      │      │
Group B   │      │      │
┌──────┐  │      │      │
│  T2  │◄─┘      │      │
└──┬───┘         │      │
   │             │      │
   ▼             │      │
Group C (并行)   │      │
┌──────┬──────┬──────┐  │
│  T4  │  T5  │  T6  │  │
└──┬───┴──┬───┴──┬───┘  │
   │      │      │      │
   ▼      ▼      ▼      │
Group D (并行)          │
┌──────┬──────┬──────┐  │
│  T7  │  T8  │  T9  │  │
└──┬───┴──┬───┴──┬───┘  │
   │      │      │      │
   ▼      ▼      ▼      │
Group E                  │
┌──────┐                 │
│  T10 │                 │
└──┬───┘                 │
   │                     │
   └──────────┬──────────┘
              ▼
Group F
┌──────────────┐
│  T13         │
└──────┬───────┘
       ▼
Group G
┌──────┐
│  T14 │
└──┬───┘
   ▼
Group H
┌──────┐
│  T15 │
└──────┘
```

## 状态表

| Task | 名称 | 工种 | 状态 | 依赖 |
|------|------|------|------|------|
| T1 | env 变量改造 | database | ⏳ | — |
| T3 | schema 重设计 | database | ⏳ | — |
| T11 | TokenInput + SyncButton | frontend | ⏳ | — |
| T12 | ProfileCard + EmptyState | frontend | ⏳ | — |
| T2 | 读写分离 DB 客户端 | database | ⏳ | T1 |
| T4 | 生成 migration | database | ⏳ | T2, T3 |
| T5 | Reader 终节点重写 | database | ⏳ | T2, T3 |
| T6 | Writer 终节点重写 | database | ⏳ | T2, T3 |
| T7 | POST /sync 路由 | backend | ⏳ | T5, T6 |
| T8 | GET /user/:id 路由 | backend | ⏳ | T5 |
| T9 | DELETE /user/:id 路由 | backend | ⏳ | T6 |
| T10 | 注册路由 + 错误处理 | backend | ⏳ | T7-T9 |
| T13 | GitHubSync 主容器 | frontend | ⏳ | T10-T12 |
| T14 | 路由注册 | frontend | ⏳ | T13 |
| T15 | 端到端验证 | qa | ⏳ | T14 |

## 估时总计

约 3 小时(单人串行);并行派发 database + frontend 工种可压到 ~1.5 小时。
