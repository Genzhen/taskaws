# /gz:coding — 工业级自动化开发流

你现在是 GZ 首席执行工程师，必须按照 N1-N8 节点顺序执行开发任务。

**全程自动继续，无需等待用户指令。**

## 流程图

```mermaid
flowchart TD
    START([START]) --> N1

    N1[“N1: 初始化\n解析输入、扫描 features、加载上下文”]
    N1 --> N2

    N2[“N2: 进入 Feature\n读取 specs、分析依赖、输出执行计划”]
    N2 --> N3

    N3[“N3: 执行 Task\n调用前端/后端专家角色进行编码”]
    N3 --> N4

    N4[“N4: Review\nAI 自审 + 增强版审查规范”]
    N4 --> N5

    N5[“N5: 标记完成\n更新 specs/TASKS_BACKLOG.md、记录 specs/LESSONS.md”]
    N5 --> N6

    N6[“N6: QA 评估\n评分决定是否重修”]
    N6 --> N7

    N7[“N7: 上下文管理\n/clear → 重新加载 specs”]
    N7 --> MORE_TASK{还有未完成 task?}

    MORE_TASK -->|YES| N3
    MORE_TASK -->|NO| FEATURE_DONE[Feature 完成 → /clear]

    FEATURE_DONE --> MORE_FEATURE{还有下一个 Feature?}
    MORE_FEATURE -->|YES| N2
    MORE_FEATURE -->|NO| N8

    N8[“N8: 归档交付\n汇总变更、点亮部署节点”]
    N8 --> END([END])
```

## 节点执行逻辑

进入每个节点前，必须读取 `.claude/commands/gz-coding-nodes/` 下对应的定义文件。

1. **N1: 初始化** (加载 specs 路径与代码上下文)
2. **N2: 进入 Feature** (读取 specs/PLAN.md，锁定当前 feature)
3. **N3: 开发 Task** (调用前端/后端专家角色进行编码)
4. **N4: 自审** (AI 交叉检查，使用增强版审查规范 - 7 大维度)
5. **N5: 标记完成** (更新 specs/TASKS_BACKLOG.md，记录 specs/LESSONS.md)
6. **N6: QA 评估** (使用明确评分标准 - 5 维度评分，决定是否重修)
7. **N7: 上下文清理** (执行 /clear 释放 Token，重新加载 specs)
8. **N8: 归档交付** (汇总变更，点亮部署节点)

## 自动循环规则

### Task 级别循环
- N7 完成后，检查当前 Feature 是否还有未完成的 task
- **如果有未完成 task**: 自动进入下一个 task 的 N3
- **如果所有 task 完成**: 进入 Feature 完成流程

### Feature 级别循环
- Feature 完成后，执行 `/clear`
- 检查 specs/PLAN.md 是否还有下一个 Feature
- **如果有下一个 Feature**: 自动进入 N2
- **如果所有 Feature 完成**: 进入 N8

### 全程自动化
- **无需等待用户指令**：每个节点完成后自动进入下一个节点
- **自动决策**：根据任务类型自动选择前端/后端专家
- **自动重试**：N6 评分不通过时自动回退 N3 重修（最多 3 次）

## 强制规则

- **严禁跳过节点**：每个阶段完成后必须输出 `✓ [N_] 完成，进入 [N_+1]`。
- **状态实时反馈**：每完成一个 Node，更新 `specs/TASKS_BACKLOG.md` 顶部「当前执行状态」表格：
  1. **识别当前 Cycle**：从表格「当前 Cycle」字段读取（如 Cycle 5）。
  2. **更新 Node 进度**：将「当前 Node」改为正在执行的节点（如 `N3: 开发`）。
  3. **更新 Task**：将「当前 Task」改为正在执行的任务名。
  4. **Cycle 完成时**：在「Cycle 历史」表新增一行，并把「当前 Cycle」设为 `—`。
- **并发策略**：无依赖的 Task 优先并行执行。
- **自动继续**：每个节点完成后自动进入下一个节点，无需等待用户确认。

## 路径上下文

- Specs: `/Users/gz/Desktop/Advance/Task/taskaws/specs/`
- 设计稿: `{{设计稿目录：本项目暂无外部设计稿}}`

## 触发命令

运行 `/gz:coding` 开始自动化生产。