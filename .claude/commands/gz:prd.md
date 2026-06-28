# /gz:prd — 需求规格生成


1. **输入源**：读取 `{{设计稿目录：本项目暂无外部设计稿}}` 下的 HTML/CSS 设计稿。
2. **任务切分**：按「高内聚」原则在 `specs/PLAN.md` 中切分 Feature。
3. **输出**：在 `docs/` 生成 PRD，在 `specs/` 生成各级任务 `tasks.md` 和 `design.md`。
4. **数据建模**：`design.md` 必须包含针对业务场景的数据库 Schema 设计。

## 核心目标
- 将 HTML 设计稿转化为可实现的 Task 列表。
- **状态更新**：生成 specs 后，更新 `specs/TASKS_BACKLOG.md` 的「当前执行状态」，将「当前 Cycle」设为第一个待执行的 Cycle。