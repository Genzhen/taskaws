---
name: gz-code-reviewer
description: 两轮代码审查 + 安全扫描，发现安全问题时暂停流水线并报告
---

# gz-code-reviewer — 代码审查与安全扫描

> ⚠️ **栈适配说明**：本 skill 从原 headshot-studio 项目移植。正文详细示例若仍出现旧栈（Lambda / Prisma / Next.js 等），**一律以本仓库 `.claude/rules/` 与 `.claude/CLAUDE.md` 描述的 taskaws 真实栈为准**（React Router 7 SPA + Hono + Drizzle + node-postgres + better-auth）。

对变更代码进行两轮质量审查和安全扫描。

## 输入

- 变更的文件列表（通过 `git diff --name-only` 获取）
- Feature 名称和 specs 路径

## 执行步骤

### 1. 收集变更

```bash
git diff --name-only HEAD
git diff HEAD
```

如果没有 git 变更，则对比 specs 中 tasks.md 涉及的文件。

### 2. 第 1 轮审查：代码质量

逐文件检查：

- **风格一致性**: 对照 `.claude/rules/` 中的规范
- **类型安全**: 是否有 any、类型断言过多、缺少类型定义
- **逻辑正确性**: 边界条件、空值处理、错误处理
- **命名规范**: 变量/函数/组件命名是否清晰
- **tRPC 规范**: procedure 是否正确使用 public/protected、输入是否 zod 校验
- **React 规范**: 是否React Router 7 SPA 模式下全为客户端、hooks 使用是否规范

输出审查结果，标注 `[PASS]` `[WARN]` `[FAIL]`。

### 3. 第 2 轮审查：架构与性能

- **架构一致性**: 是否符合 design.md 中的设计方案与 monorepo 分层
- **模块边界**: 是否有不合理的跨包依赖（如 apps/web 直接 import packages/db）
- **性能**:
  - 不必要的重渲染（missing memo/useCallback 在昂贵渲染）
  - N+1 查询（Drizzle 未用 with/select）
  - 大循环、内存泄漏风险（未清理的 effect、未取消的请求）
- **长驻进程适配**: 是否有违反无状态的设计（模块级单例被破坏、请求间状态泄漏）
- **可维护性**: 代码是否易于理解和修改

### 4. 安全扫描

基于 taskaws 的安全要求逐项扫描：

**必检项：**

- [ ] 硬编码的密钥、Token、密码、API Key（尤其 AI 服务/支付密钥）
- [ ] 使用 `dangerouslySetInnerHTML` 未清洗输入
- [ ] URL 中传递敏感参数
- [ ] `eval()`、`new Function()` 等动态执行
- [ ] 环境变量使用是否正确（VITE_ 前缀 vs 服务端）
- [ ] 敏感文件是否被 .gitignore 覆盖（.env、apps/server/.env）
- [ ] 第三方依赖是否有已知漏洞（`pnpm audit`）
- [ ] XSS 注入风险
- [ ] CSRF 防护（Better-Auth 默认已启用，检查 trustedOrigins 配置）
- [ ] SQL 注入（Drizzle sql 模板参数化，禁止 sql.raw 拼接）
- [ ] CORS 配置（env.CORS_ORIGIN 是否正确设置）
- [ ] 认证边界（受保护接口是否正确使用 protectedProcedure）
- [ ] 文件上传：文件类型校验、大小限制、恶意文件检测

### 5. 结果处理

#### 安全扫描通过 ✅

```
[SECURITY SCAN] ✅ PASSED
- 扫描文件数: N
- 检查规则数: N
- 未发现安全问题
```

继续流水线下一步。

#### 安全扫描发现问题 ❌

**立即暂停流水线**，输出详细报告：

```
🚨 安全扫描警告 — taskaws / {feature-name}

发现 {N} 个安全问题：

1. [{严重程度}] {问题描述}
   📄 文件: {file_path}:{line}
   💡 建议: {修复建议}

2. ...

请确认是否继续：
- /approve — 确认已知风险，继续流水线
- 或给出修复指示
```

等待用户确认后：
- 收到 `/approve` → 记录审批，继续流水线
- 收到修复指示 → 返回给调用者，触发修复流程

#### 代码质量问题（非安全）

如果只有代码质量问题（无安全问题）：
- 自动修复可修复的问题
- 重新审查（最多 3 轮）
- 3 轮后仍有问题则报告给用户

## 输出

```markdown
## 审查报告

### 第 1 轮：代码质量
- 审查文件数: N
- PASS: N | WARN: N | FAIL: N
- {具体问题列表}

### 第 2 轮：架构与性能
- {具体问题列表}

### 安全扫描
- 状态: PASSED / FAILED
- {问题列表（如有）}

### 总结
- 审查结果: {APPROVED / NEEDS_FIX / SECURITY_HOLD}
```
