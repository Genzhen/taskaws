---
description: 安全规范，覆盖密钥管理、认证边界、输入校验、XSS/注入、CORS
---

# Security

## 密钥管理

- 所有密钥通过 `@taskaws/env` 读取（server 走 `@taskaws/env/server`，web 走 `@taskaws/env/web`），**绝不硬编码**
- `VITE_` 前缀的变量会暴露到前端 bundle，只用于真正需要客户端读的值（如 `VITE_SERVER_URL`）；密钥绝不加 `VITE_` 前缀
- `.env` / `apps/server/.env` 必须在 `.gitignore` 中（Drizzle 的 `migrations/` 需提交，不是密钥）

## 认证边界

- 需要登录的 tRPC procedure 必须用 `protectedProcedure`，不能用 `publicProcedure` 后再手动检查
- 服务端取会话用 `auth.api.getSession({ headers })`（Hono 路由 / tRPC context，见 [auth.md](auth.md)）
- 不可信的 session 数据（如角色）从 DB 重新查，不信任 client 传入

## 输入校验

- 所有 tRPC procedure 输入必须 zod 校验，包括枚举值
- 文件上传：校验 `fileType`、`fileSize`、文件名（只允许安全字符）
- URL 参数：不传敏感数据（如 token、密码）

## XSS / 注入

- 禁止 `dangerouslySetInnerHTML`，如必须使用需 DOMPurify 清洗
- 禁止 `eval()`、`new Function()`
- SQL 一律走 Drizzle 的 `sql` 模板（参数化），禁止 `sql.raw` 或字符串拼接

## CORS

- 后端 CORS `origin` 与 better-auth `trustedOrigins` 精确配置到生产域名，禁止 `*`
- 跨域 cookie 场景：`credentials: true` + cookie `sameSite: "none"` + `secure: true`
- 本地开发：`CORS_ORIGIN=http://localhost:3001`，`BETTER_AUTH_URL=http://localhost:3000`

## 第三方服务（接入时遵循）

- Stripe webhook：用 `stripe.webhooks.constructEvent()` 验签，raw body 读取（不经 `JSON.parse`），失败返回 400
- 文件存储：用预签名 URL，不经服务端中转文件内容；禁止用户控制对象 key 路径（服务端生成 `{userId}/{uuid}.{ext}`）

## 速率限制

- Better-Auth 内置速率限制：`rateLimit: { enabled: true, window: "1m", max: 10 }`（见 auth.md）
- Hono 可加自定义速率限制中间件（按 IP / userId），防止暴力破解/爬虫
- tRPC mutation 接口（注册/登录/支付）优先保护；query 接口适度放宽

## 会话与 Cookie 安全

- Better-Auth cookie 配置（跨域 SPA 场景）：
  ```typescript
  advanced: {
    defaultCookieAttributes: {
      sameSite: "none",  // 跨域必需
      secure: true,      // HTTPS 必需（本地开发可用 false）
      httpOnly: true,    // 防 XSS 读取
    },
  },
  ```
- Session 有效期：Better-Auth 默认 7 天；敏感操作（支付/修改密码）需二次验证
- 登出后 session 记录必须从 DB 删除（Better-Auth 自动处理），不依赖 cookie 清除

## 日志与错误处理

- 生产环境不返回完整 stack trace，只返回用户友好的错误消息
- 服务端日志不记录密钥、密码、session token 等敏感值；如需记录需脱敏（如只记前 8 字符）
- tRPC 错误用 `TRPCError` 标准码（`UNAUTHORIZED` / `FORBIDDEN` / `NOT_FOUND` 等），不暴露内部实现细节
- Hono `logger()` 中间件日志需过滤敏感 header（如 `Authorization` / `Cookie`）

## 前端安全（SPA）

- 认证状态由 `useSession()` 管理，受保护页面在组件入口判断未登录则跳转 `/login`
- 前端绝不存储敏感数据（密码、密钥）到 localStorage / sessionStorage；session 由 Better-Auth cookie 管理
- URL 参数不传递 token / password，用 POST body 或 header
- 使用 HTTPS 时确保 `BETTER_AUTH_URL` / `VITE_SERVER_URL` 均为 https 协议（否则 cookie `secure: true` 不生效）

## 依赖安全

- 定期运行 `pnpm audit` 检查依赖漏洞；高危漏洞立即升级或替换
- `pnpm audit --fix` 自动修复可修复的漏洞；无法修复的需人工评估风险
- 新增依赖前检查维护状态、下载量、安全历史（避免无人维护/频繁漏洞的包）
- 锁文件 `pnpm-lock.yaml` 需提交，防止依赖版本漂移导致安全漏洞

## 生产部署安全

- 强制 HTTPS：`BETTER_AUTH_URL` / `CORS_ORIGIN` 均为 https
- 环境隔离：生产 `.env` 不共享开发环境密钥；`BETTER_AUTH_SECRET` 生产单独生成
- CORS `origin` 精确到生产域名（如 `https://app.example.com`），禁止 `*` 或通配符
- Better-Auth `trustedOrigins` 与 CORS `origin` 保持一致
- 数据库访问限制：生产 DB 仅允许后端服务器 IP 访问；禁止公网直连
- 健康检查端点（`GET /` 返回 `OK`）不暴露内部信息（如版本/依赖）
