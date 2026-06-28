---
description: 前端开发规范，React Router 7 (SPA) + React 19 + Tailwind CSS 4 + tRPC Client，适用于 apps/web
---

# Frontend

## React Router 7（SPA）

- **SPA 模式**：`react-router.config.ts` 配置 `ssr: false`，纯客户端渲染，**没有 Server Components / 没有 RSC**。
- **文件路由**：用 `@react-router/fs-routes`，路由文件放 `apps/web/src/routes/`（`_index.tsx`、`login.tsx`、`dashboard.tsx`）。
- **入口**：`apps/web/src/root.tsx` 为根布局；`routes.ts` 汇总路由。
- 构建：`react-router build`；开发：`react-router dev`（vite）；启动产物：`react-router-serve`。
- 数据获取全部在客户端，通过 tRPC / TanStack Query（见下）。

## Tailwind CSS 4

- CSS-first 配置：在 `globals.css` 用 `@theme` 定义 design token，不依赖 `tailwind.config.js`（v4 废弃）。
- 颜色通过 CSS 变量（`--primary`、`--background` 等），配合 `@taskaws/ui` 的主题变量。
- 主题切换用 `next-themes`（见 `src/components/theme-provider.tsx`、`mode-toggle.tsx`）。

## tRPC Client（TanStack Query）

- 封装在 `apps/web/src/utils/trpc.ts`（`@trpc/tanstack-react-query`）。
- 查询：`trpc.<router>.<procedure>.useQuery(...)`；变更：`...useMutation(...)`。
- 变更成功后调用 `utils.<router>.<procedure>.invalidate()` 刷新缓存。
- **没有 server-side caller**（SPA 模式）——所有数据走 HTTP 到后端 `/trpc/*`。

## 组件与 UI

- 共享 UI 用 `@taskaws/ui`（shadcn 风格，基于 `@base-ui/react`、`class-variance-authority`、`tailwind-merge`）。
- 图标用 `lucide-react`；通知用 `sonner`；表单用 `@tanstack/react-form`。
- 组件文件 PascalCase，放在 `apps/web/src/components/` 下按功能分目录。
- 不在组件里直接操作 DOM（用 refs 或 state）。

## 认证

- 客户端用 `apps/web/src/lib/auth-client.ts`（`createAuthClient({ baseURL: env.VITE_SERVER_URL })`）。
- `useSession()` 取会话；`signIn` / `signOut` 触发认证。受保护页面在路由 loader/组件内判断未登录则跳 `/login`。

## 性能

- `React.memo` / `useCallback` / `useMemo` 只在 profile 证明有性能问题后再加（不要预优化）。
- 大型列表用虚拟滚动；非首屏重型组件用动态 `import`。
- 图片用原生 `<img>`（本项目无 `next/image`）；远程图按需 lazy loading。

## 项目结构

```
apps/web/src/
├── routes/              # 文件路由（@react-router/fs-routes）
│   ├── _index.tsx       # 首页（layout route，带 _ 前缀）
│   ├── login.tsx        # 登录页
│   └── dashboard.tsx    # 受保护页面（需登录）
├── components/          # 可复用组件
│   ├── header.tsx       # 全局 Header
│   ├── sign-in-form.tsx # 登录表单
│   ├── github-sync/     # 功能模块组件（按目录分组）
│   └── theme-provider.tsx
├── lib/                 # 工具库/客户端封装
│   └── auth-client.ts   # Better-Auth 客户端
├── utils/               # 工具函数
│   └── trpc.ts          # tRPC 客户端 + QueryClient
├── root.tsx             # 根布局（Layout + App + ErrorBoundary）
└── routes.ts            # 路由配置（flatRoutes）
```

- 路由文件用 `@react-router/fs-routes` 自动发现，`_index.tsx` 对应 `/`（layout route）。
- 组件按功能分目录（如 `github-sync/`），避免扁平化堆积。
- `lib/` 放第三方 SDK 封装（auth-client），`utils/` 放纯工具（trpc、helpers）。

## 错误处理

- **全局 ErrorBoundary**：在 `root.tsx` 定义，捕获路由级错误（404、渲染异常）。
  ```tsx
  export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
    if (isRouteErrorResponse(error)) {
      // 处理 404、500 等
    } else if (import.meta.env.DEV && error instanceof Error) {
      // 开发环境显示完整 stack
    }
  }
  ```
- **API 错误**：`QueryClient` 的 `queryCache.onError` 自动用 `toast.error` 显示，带 retry 按钮（见 `utils/trpc.ts`）。
- **组件级错误**：关键操作（表单提交）在 `catch` 里用 `toast.error`，成功用 `toast.success`。

## 开发工具

- **React Query Devtools**：`<ReactQueryDevtools position="bottom" />` 挂在 `root.tsx`，开发环境自动启用。
- **React Router Devtools**：依赖 `react-router-devtools`（package.json devDependencies），开发模式右下角图标。
- **浏览器调试**：Devtools 中可查看 TanStack Query 缓存状态、tRPC 请求日志。

## 样式约定

- **布局**：根布局用 `h-svh`（100vh 小键盘兼容）+ `grid grid-rows-[auto_1fr]`（Header + Content）。
- **容器**：页面内容用 `container mx-auto`（居中 + 最大宽度限制）。
- **间距**：组件内部间距用 Tailwind spacing（`p-4`、`gap-2`），避免硬编码数值。
- **暗色模式**：`ThemeProvider` 通过 `class` 策略切换，CSS 变量驱动（见 `globals.css`）。
- **字体**：Google Fonts（Inter + Geist + JetBrains Mono）在 `root.tsx` 的 `links` 预加载。

## 状态管理

- **数据状态**：TanStack Query 作为唯一数据缓存层（无 Redux/MobX/Zustand）。
  - 服务器数据：`trpc.*.useQuery()` 自动缓存。
  - 表单状态：`@tanstack/react-form` 管理（见 `sign-in-form.tsx`）。
  - UI 状态：React `useState` / `useReducer`（如 modal 开关、loading 标记）。
- **缓存刷新**：mutation 成功后调用 `utils.<router>.<procedure>.invalidate()` 刷新相关查询。
