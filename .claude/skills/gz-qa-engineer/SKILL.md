---
name: gz-qa-engineer
description: QA 工程师 Skill，执行功能测试、E2E 测试、可视化回归、验收标准核验，自动适配 Vitest + Playwright 测试框架
---

# gz-qa-engineer — QA 工程师

在开发任务完成后执行整体质量验证。遵循 Headshot Studio 的 Vitest + Playwright 测试规范。

## 触发条件

由 `/gz:coding` 自动调用，当 task 涉及测试或全部开发完成后触发。

## 工作流程

### 1. 识别测试框架

Headshot Studio 测试栈：

- **单元/组件测试**: Vitest + React Testing Library
- **E2E 测试**: Playwright
- **可视化回归**: Playwright screenshot + 基准对比
- **覆盖率**: c8 / vitest 内置 coverage

### 2. 读取上下文

必读文件：
- `requirements.md` 中的验收标准（AC）
- `design.md` 了解功能模块和接口契约
- `.claude/rules/testing.md`（如存在）
- 现有测试文件（`apps/web/src/**/*.test.ts*`、`e2e/` 或 `tests/`）

### 3. 补全测试

对开发阶段未写测试的代码补充：

- **组件** (`apps/web/src/components/`):
  - 渲染测试（组件是否正确渲染）
  - 交互测试（点击、表单提交、导航）
  - Props 边界（空数据、错误状态、loading）
  - 使用 React Testing Library 的 `render`、`screen`、`fireEvent`

- **tRPC Router** (`packages/api/src/routers/`):
  - 正常流：合法输入返回预期结果
  - 异常流：未认证、未授权、输入非法
  - 边界值：空数组、超长字符串、特殊字符
  - 使用 caller 直接调用 router 测试，无需启动 HTTP server

- **工具函数** (`packages/*/src/utils/`):
  - 纯函数单元测试：输入输出覆盖

- **数据库层**:
  - migration 可执行（`pnpm db:migrate` 在空库上成功）
  - seed 可执行
  - 关键查询结果正确

测试文件命名：`{filename}.test.ts` / `{filename}.test.tsx`，放在源文件同目录。
E2E 测试放在 `apps/web/e2e/` 或根目录 `e2e/`。

### 4. 运行测试

```bash
# 单元/组件测试
pnpm test                # 或 pnpm -F web test
pnpm test -- --coverage  # 覆盖率

# E2E 测试
pnpm e2e                 # 或 npx playwright test

# 类型检查
pnpm check-types
```

收集：通过数/失败数/覆盖率。

### 5. 可视化回归（如涉及 UI）

1. 启动开发服务器：`pnpm dev:web` (port 3001)
2. 选择浏览器驱动：
   - **默认：Playwright 无头模式** — 适合截图对比、DOM 断言
   - **升级：Chrome DevTools MCP** — 需登录态/OAuth 弹窗/动画观察时切换
   - 切换前输出：`🔄 切换到 Chrome DevTools MCP — 原因: {原因}`
3. 关键页面截图：
   - Landing Page (`/`)
   - Sign In / Sign Up (`/sign-in`, `/sign-up`)
   - Upload & Generate (`/upload`)
   - Portrait Gallery (`/gallery`)
   - Pricing Plans (`/pricing`)
4. 与 `specs/{feature}/screenshots/` 基准对比
5. 首次运行保存基准截图

### 6. 验收标准核验

逐条检查 requirements.md 中的 AC：

```markdown
- [x] [AC-001] 用户可以上传 JPG/PNG 图片 → 已通过 E2E 测试验证
- [x] [AC-002] 生成结果保存到数据库 → 已通过 tRPC router 测试验证
- [ ] [AC-003] 支付成功后自动发放 credits → ⚠️ 需手动验证（需 Stripe/Polar 测试账号）
```

标注每条的验证方式（自动/手动/无法自动化）。

### 7. 处理失败

- 测试失败 → 判断是代码 bug 还是测试问题
- 代码 bug → 记录在回报里，交主流程处理，不擅自改业务代码
- 测试问题 → 修复测试，重新运行
- 最多重试 3 轮

## 常见坑

| 问题                     | 处理                                   |
| ------------------------ | -------------------------------------- |
| 测试环境和开发环境不一致 | 检查 `.env.test` 配置，mock 第三方服务 |
| 异步测试超时             | 增加 timeout，检查是否缺少 await       |
| E2E 测试不稳定（flaky）  | 用 `waitFor` 代替固定延时              |
| 覆盖率统计不准           | 检查 vitest coverage include/exclude   |
| tRPC 测试需认证上下文    | 用 `createContext` mock session        |
| 数据库测试污染           | 每个测试用例用事务隔离或独立测试库     |

## Headshot Studio 关键用户路径（必测）

1. **注册/登录流**: Sign Up → Email 验证 → Sign In → Session 持久化
2. **头像生成流**: Upload Photo → 选择风格 → Generate → 等待处理 → 查看结果
3. **付费流**: 查看 Pricing → 选择套餐 → 支付 → Credits 增加
4. **画廊流**: 查看已生成头像 → 下载 → 删除

## 输出

```text
📋 QA 报告

测试: {N} 通过 / {N} 失败 / 覆盖率 {N}%
E2E: {状态}
可视化回归: {状态}
验收标准: {N}/{total} 通过, {N} 需手动验证
安全扫描: {状态}
结论: {PASSED / FAILED / NEEDS_MANUAL}
```
