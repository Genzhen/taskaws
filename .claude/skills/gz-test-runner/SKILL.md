---
name: gz-test-runner
description: 自动生成测试用例并运行单元测试、组件测试、E2E 测试，使用 Playwright 做可视化回归
---

# gz-test-runner — 自动化测试运行器

根据变更自动生成/更新测试，运行完整测试套件。

## 输入

- Feature 名称和 specs 路径
- 变更的文件列表

## 执行步骤

### 1. 检查测试基础设施

检查 Headshot Studio 测试配置：

```bash
# 检查各包测试依赖
grep -E "vitest|playwright|@testing-library" apps/web/package.json
grep -E "vitest" packages/*/package.json
```

如未配置，先安装（以 web 应用为例）：

```bash
pnpm -F web add -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

确保 `apps/web/vitest.config.ts` 配置正确：

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
});
```

### 2. 生成测试用例

对每个变更的源文件：

- **组件文件** (`apps/web/src/components/**/*.tsx`):
  - 渲染测试（组件是否正确渲染）
  - 交互测试（点击、表单、导航）
  - Props 边界（空数据、错误状态、loading）
  - 使用 React Testing Library

- **tRPC Router** (`packages/api/src/routers/*.ts`):
  - 用 tRPC caller 直接测试，无需启动 HTTP
  - 正常流/异常流/边界值
  - 认证场景：未登录、已登录、管理员

- **工具函数** (`packages/*/src/utils/*.ts`):
  - 纯函数单元测试：输入输出覆盖

- **Hooks** (`packages/*/src/hooks/*.ts`):
  - `renderHook` 测试

测试文件放在源文件同目录，命名为 `{filename}.test.tsx` / `{filename}.test.ts`。

### 3. 运行单元/组件测试

```bash
pnpm test                # 或 pnpm -F web test
pnpm test -- --coverage  # 覆盖率
```

收集：
- 通过/失败/跳过的测试数
- 失败测试的详细信息
- 覆盖率报告

### 4. 运行 E2E 测试（Playwright）

```bash
# 检查 playwright 配置
test -f apps/web/playwright.config.ts && pnpm -F web e2e

# 或直接
pnpm exec playwright test
```

### 5. 可视化回归（Playwright）

如果变更涉及 UI 组件：

1. 确保开发服务器运行：`pnpm dev:web` (port 3001)
2. 使用 Playwright 截图：
   - `mcp__playwright__browser_navigate` 打开关键页面
   - `mcp__playwright__browser_take_screenshot` 截图
   - 与 `specs/{feature}/screenshots/` 基准对比
3. 首次运行保存基准截图
4. 后续运行对比差异

### 6. 处理失败

如果测试失败：
- 分析失败原因
- 区分是测试问题还是代码问题
- 代码问题 → 返回具体的失败信息给调用者
- 测试问题 → 修复测试后重新运行
- 最多重试 3 轮

## 输出

```markdown
## 测试报告

### 单元测试 / 组件测试
- 框架: Vitest
- 总计: N | 通过: N | 失败: N | 跳过: N
- 覆盖率: N%
- {失败详情（如有）}

### E2E 测试
- 框架: Playwright
- 状态: {PASSED / FAILED / SKIPPED}
- {详情}

### 可视化回归
- 截图页面: N
- 差异: {无差异 / 发现 N 处差异}

### 总结
- 测试结果: {PASSED / FAILED}
- {需要修复的问题列表（如有）}
```
