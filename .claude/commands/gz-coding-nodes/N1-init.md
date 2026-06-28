# N1: 初始化

## 执行流程

### 1. 解析输入

从 `$ARGUMENTS` 中解析：
- Specs 路径（默认: `/Users/gz/Desktop/Advance/Task/taskaws/specs/`）
- 代码路径（默认: 当前项目根目录）
- 设计稿路径（默认: `{{设计稿目录：本项目暂无外部设计稿}}`）

### 2. 扫描 Features

读取 `specs/PLAN.md`，提取所有 Feature 列表：

```markdown
## 示例 PLAN.md 结构

# 开发计划

## Features

### F1: 项目框架搭建
- 状态: completed
- 任务: 5/5

### F2: 认证系统
- 状态: in_progress
- 任务: 3/8

### F3: Landing Page
- 状态: pending
- 任务: 0/10

...
```

输出：
```
发现 {N} 个 Features:
1. {F1_name}: {status} ({completed}/{total} tasks)
2. {F2_name}: {status} ({completed}/{total} tasks)
...
```

### 3. 加载上下文

根据任务类型智能加载相关文档：

#### 3.1 基础上下文（必须加载）
- `.claude/CLAUDE.md` - 项目说明
- `.claude/rules/*.md` - 开发规范
- `specs/LESSONS.md` - 经验教训（如存在）
- `specs/TASKS_BACKLOG.md` - 任务清单 + 当前执行状态

#### 3.2 根据 Feature 类型加载

**前端 Feature**:
- `specs/{feature}/requirements.md`
- `specs/{feature}/design.md`
- `specs/{feature}/tasks.md`
- 设计稿（如存在）

**后端 Feature**:
- `specs/{feature}/requirements.md`
- `specs/{feature}/api-design.md`
- `specs/{feature}/tasks.md`
- `packages/db/prisma/schema.prisma`

**AI 集成 Feature**:
- `specs/{feature}/requirements.md`
- `specs/{feature}/ai-design.md`
- `specs/{feature}/tasks.md`
- AI 服务文档（Replicate/RunPod 等）

**支付 Feature**:
- `specs/{feature}/requirements.md`
- `specs/{feature}/payment-design.md`
- `specs/{feature}/tasks.md`
- 支付服务文档（Stripe/Polar 等）

#### 3.3 根据修改文件加载

**修改了 schema.prisma**:
- 加载数据库规范
- 加载迁移指南
- 加载相关 API 代码

**修改了 tRPC 路由**:
- 加载 API 规范
- 加载前端调用代码
- 加载测试用例

**修改了组件**:
- 加载设计规范
- 加载相关页面
- 加载组件测试

#### 3.4 根据错误类型加载

**类型错误**:
- 加载 TypeScript 规范
- 加载相关类型定义

**运行时错误**:
- 加载错误日志
- 加载相关代码
- 加载类似问题的经验

**性能错误**:
- 加载性能优化指南
- 加载相关代码
- 加载性能监控数据

### 4. 识别当前状态

读取 `specs/TASKS_BACKLOG.md` 顶部「当前执行状态」和「Cycle 历史」，识别：
- 当前处于哪个 Cycle
- 哪些 Feature 已完成
- 哪些 Feature 正在进行
- 哪些 Feature 待开始

输出：
```
当前状态:
- 已完成 Features: {count}
- 进行中 Features: {count}
- 待开始 Features: {count}
- 当前 Cycle: Cycle {N}
```

### 5. 输出执行计划

```markdown
## 执行计划

### 待执行的 Features
1. {F2_name} - {completed}/{total} tasks (进行中)
2. {F3_name} - 0/{total} tasks (待开始)
...

### 第一个待执行的 Feature
Feature: {F2_name}
Tasks: {total}
已完成: {completed}
待完成: {remaining}

准备进入 [N2] 开始执行...
```

## 智能加载规则

### 规则 1: 按需加载
- 不要一次性加载所有文档
- 只加载当前 Feature 相关的文档
- 根据任务类型选择性加载

### 规则 2: 优先级加载
- 高优先级: CLAUDE.md, rules/, 当前 feature specs
- 中优先级: specs/LESSONS.md, 相关代码
- 低优先级: 历史文档, 其他 feature specs

### 规则 3: 动态加载
- 执行过程中根据需要动态加载
- 遇到错误时加载相关经验
- 发现新需求时加载相关文档

## 特殊情况处理

### 1. specs/PLAN.md 不存在
- 询问用户是否有 specs/PLAN.md
- 如果没有，使用 `specs/TASKS_BACKLOG.md` 作为任务清单
- 或者要求用户先创建 specs/PLAN.md

### 2. Specs 目录不存在
- 询问用户是否有 specs 目录
- 如果没有，根据 PRD 创建 specs 结构
- 或者要求用户先创建 specs

### 3. 设计稿不存在
- 询问用户是否有设计稿
- 如果没有，根据 design.md 自行实现
- 或者要求用户提供设计稿

### 4. 上下文过大
- 如果加载的文档过多，执行 `/compact`
- 保留关键信息，删除冗余信息
- 继续执行

## 输出格式

```
✓ [N1] 初始化完成

## 项目信息
- Specs: {path}
- 代码: {path}
- 设计稿: {path}

## Features 概览
发现 {N} 个 Features:
1. {F1_name}: {status} ({completed}/{total} tasks)
2. {F2_name}: {status} ({completed}/{total} tasks)
...

## 当前状态
- 已完成: {count} Features
- 进行中: {count} Features
- 待开始: {count} Features

## 上下文加载
✅ CLAUDE.md
✅ rules/*.md
✅ specs/LESSONS.md
✅ specs/TASKS_BACKLOG.md
✅ {feature}/specs

## 下一步
准备进入 [N2] 开始执行第一个待执行的 feature...
```

## 强制规则

- **必须扫描 specs/PLAN.md**: 识别所有 Features
- **必须智能加载**: 根据任务类型加载相关文档
- **必须识别状态**: 从 specs/TASKS_BACKLOG.md「当前执行状态」读取当前 Cycle 和 Node
- **必须输出计划**: 明确待执行的 Features
- **必须自动继续**: 无需等待用户确认
