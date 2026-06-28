# N7: 上下文清理与自动循环

## 执行流程

### 1. 上下文清理

```bash
# 执行 /clear 释放 Token
/clear
```

### 2. 重新加载上下文

重新读取以下文件：

- 当前 feature 的 specs（requirements.md、design.md、tasks.md）
- `specs/LESSONS.md`
- 代码项目的 `.claude/CLAUDE.md` + `.claude/rules/`
- `specs/TASKS_BACKLOG.md`（更新执行状态）

### 3. 检查任务状态

读取当前 feature 的 `tasks.md`，检查任务完成情况：

```markdown
## 检查逻辑

### 情况 1: 还有未完成的 task
- 找到第一个未完成（未标记 [x]）的 task
- 输出: `✓ [N7] 完成，发现未完成的 task，进入 [N3] 执行下一个 task`
- **自动进入 N3**，执行下一个 task

### 情况 2: 当前 feature 的所有 task 已完成
- 输出: `✓ [N7] 完成，当前 feature 所有 task 已完成`
- 执行 `/clear`
- 读取 `specs/PLAN.md`，检查是否还有下一个 feature

#### 情况 2.1: 还有下一个 feature
- 输出: `✓ [N7] 发现下一个 feature: {feature_name}，进入 [N2]`
- **自动进入 N2**，开始下一个 feature

#### 情况 2.2: 所有 feature 已完成
- 输出: `✓ [N7] 完成，所有 feature 已完成，进入 [N8]`
- **自动进入 N8**，归档交付

## 自动循环规则

### Task 级别循环
```
N3 → N4 → N5 → N6 → N7 → (检查 tasks)
  ↓ 还有未完成 task
  → N3 (继续下一个 task)
```

### Feature 级别循环
```
所有 task 完成 → N7 → (检查 specs/PLAN.md)
  ↓ 还有下一个 feature
  → N2 (进入下一个 feature)
```

### 全程自动化
- **无需等待用户指令**
- **自动检查任务状态**
- **自动进入下一个节点**
- **自动清理上下文**

## 特殊情况处理

### 1. N6 评分不通过
- 回退到 N3 重修
- 记录重修原因到 `specs/LESSONS.md`
- 重修次数 +1
- 如果重修次数 >= 3，暂停并请求人工介入

### 2. 上下文达到 80%
- 执行 `/compact` 压缩上下文
- 继续执行当前 task
- 不要等待用户指令

### 3. 遇到阻塞问题
- 记录问题到 `specs/LESSONS.md`
- 输出详细的阻塞原因
- **暂停执行**，等待用户指令

### 4. 发现设计稿缺失
- 询问用户是否有设计稿
- 如果有，等待用户提供
- 如果没有，根据 PRD 自行实现

## 状态更新

每次执行 N7 后，必须更新 `specs/TASKS_BACKLOG.md` 顶部「当前执行状态」：

1. 更新「当前 Node」为下一个要执行的节点。
2. 如果当前 task 完成，更新「当前 Task」为下一个待执行 task。
3. 如果当前 Cycle 所有 task 完成，在「Cycle 历史」中记录完成状态，并清空「当前 Cycle」。

## 输出格式

### Task 循环
```
✓ [N7] 完成
当前 feature: {feature_name}
已完成 task: {completed}/{total}
发现未完成的 task: {task_name}
进入 [N3] 执行下一个 task
```

### Feature 循环
```
✓ [N7] 完成
当前 feature: {feature_name} 已完成
发现下一个 feature: {next_feature_name}
进入 [N2] 开始下一个 feature
```

### 全部完成
```
✓ [N7] 完成
所有 feature 已完成
总 task: {completed}/{total}
进入 [N8] 归档交付
```

## 强制规则

- **必须执行 /clear**: 每次完成后必须清理上下文
- **必须重新加载 specs**: 清理后必须重新读取 specs
- **必须检查任务状态**: 根据 specs/TASKS_BACKLOG.md 判断下一步
- **必须自动继续**: 无需等待用户指令
- **必须更新 specs/TASKS_BACKLOG.md**: 实时同步执行状态
