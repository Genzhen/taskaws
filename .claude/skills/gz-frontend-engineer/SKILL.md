---
name: gz-frontend-engineer
description: 前端工程师 Skill，执行前端开发任务，适配 React Router 7 (SPA) + React 19 + Tailwind CSS 4 + tRPC Client + Turborepo 技术栈（taskaws）
---

# gz-frontend-engineer — 前端工程师

> ⚠️ **栈适配说明**：本 skill 从原 headshot-studio 项目移植。正文详细示例若仍出现旧栈（Next.js App Router / Prisma / Neon / Lambda 等），**一律以本仓库 `.claude/rules/` 与 `.claude/CLAUDE.md` 描述的 taskaws 真实栈为准**（React Router 7 SPA + Hono + Drizzle + node-postgres + better-auth）。

执行前端开发任务。遵循 taskaws 的 React Router 7 (SPA) + React 19 + Tailwind CSS v4 架构规范。

## 触发条件

由 `/gz:coding` 自动调用，当 task 涉及前端开发时触发。

## 工作流程

### 0. 设计稿检查

开发前先检查 Stitch 设计稿：

- **设计稿路径**: `{{设计稿目录：本项目暂无外部设计稿}}`
- **包含页面**: Landing Page、Portrait Gallery、Pricing Plans、Sign In / Sign Up、Upload & Generate
- 有设计稿 → 按设计稿还原
- 设计稿存在但与业务需求有差距 → 按 design.md 补全缺失功能
- 没有设计稿 → 根据 design.md 和业务需求自行实现

**注意**: 你是 subagent 无法直接问用户，遇到需用户拍板的情况按 design.md 自行实现，并在产出清单里标注。

### 1. 识别技术栈

Headshot Studio 前端技术栈已固定：

- **框架**: React Router 7 (SPA, `ssr: false`)
- **UI 库**: React 19
- **样式**: Tailwind CSS v4 (CSS-first 配置, `@theme` token)
- **数据获取**: TanStack Query + tRPC Client (`apps/web/src/utils/trpc.ts`)
- **认证客户端**: `apps/web/src/lib/auth-client.ts` (better-auth/react)
- **组件/UI**: `@taskaws/ui` (基于 @base-ui/react, shadcn 风格) + lucide-react + sonner
- **Monorepo**: Turborepo + pnpm workspaces

### 2. 读取上下文

必读文件：
- `.claude/CLAUDE.md` 项目结构
- `design.md` 中当前任务相关的模块设计
- `apps/web/src/` 现有组件结构
- `packages/ui/src/` 共享 UI 组件库（**开发前先查已有组件，能复用的绝不重写**）
- `apps/web/src/lib/` API 客户端与工具函数

### 3. 开发

**组件封装与复用（重要）：**

- 开发前先检查 `packages/ui` 与 `apps/web/src/components/` 已有组件
- 新建通用 UI 组件放入 `packages/ui/src/`，确保可被其他 apps 复用
- 业务组件放 `apps/web/src/components/`，组合 UI 组件而非复制
- 如使用了 shadcn/ui 或 Radix，优先用库内组件

**Tailwind CSS v4（重要）：**

- **CSS-first 配置**：不再使用 `tailwind.config.js`，改用 CSS 变量 + `@theme`
- 设计 token 在 `apps/web/src/app/globals.css` 的 `@theme` 块定义
- 自定义变体用 `@variant`，不硬编码 class 字符串
- 复用样式通过组件封装，而非到处复制 class
- 主题色、间距、字体通过 design token 管理，不硬编码 hex 值

**Next.js 15 App Router：**

- Server Components 默认，需要交互的组件加 `'use client'`
- 路由组织用 `app/(group)/route/page.tsx`
- 并行路由、拦截路由按 design.md 使用
- 数据获取优先 Server Component（避免客户端 waterfall）
- tRPC 调用在 Client Component 用 `trpc.{router}.{procedure}.useQuery/useMutation()`

**认证 UI：**

- 使用 `packages/auth` 导出的 `authClient` hooks（signIn/signUp/signOut/useSession）
- 受保护页面在 Server Component 通过 `auth.api.getSession({ headers })` 判断
- 未登录重定向用 `redirect('/sign-in')`

**状态管理：**

- 简单局部状态用 React useState/useReducer
- 服务端状态用 tRPC 的 useQuery/useMutation（内置缓存）
- 全局客户端状态用 Context 或 zustand（如 design.md 指定）

**API 调用：**

- 基于 tRPC 类型安全调用，不手写 fetch
- 后端未就绪 → 先写 mock，标注 `// TODO: replace mock when API ready`
- 错误处理和 loading 状态必须覆盖

### 4. 验证

```bash
pnpm check-types   # TypeScript 类型检查
pnpm build         # 构建验证 (含 Next.js build)
```

启动开发服务器验证页面渲染：
```bash
pnpm dev:web       # port 3001
```

## 常见坑

| 问题                                    | 处理                                                     |
| --------------------------------------- | -------------------------------------------------------- |
| 'use client' 遗漏导致 browser API 报错  | 用到 useState/useEffect/window 等必须加指令              |
| Tailwind v4 配置方式错误                | 用 CSS-first `@theme`，不写 `tailwind.config.js`         |
| tRPC 客户端未正确初始化                 | 复用 `apps/web/src/lib/trpc.ts` 已有配置                 |
| 组件重复造轮子                          | 先 grep `packages/ui` 和 `components/` 已有组件          |
| 设计稿颜色与 Tailwind token 不一致      | 扩展 `@theme` 而非硬编码 hex 值                          |
| Server Component 误用 hooks             | Server Component 默认，需交互才加 'use client'           |
| 路径别名 import 报错                    | 检查 `tsconfig.json` paths 与 Next.js 配置一致           |

## 输出

- 创建/修改的文件列表
- 验证结果（typecheck + build）
- 设计稿还原情况（如有设计稿）
- 需要其他工种配合的事项（如新增 tRPC procedure 的签名）
