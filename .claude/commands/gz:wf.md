# /gz:wf — Workflow 模式开发

调用 `gz-ai-wf` workflow 开发指定 feature，或仅做项目初始化。

## 用法

```
/gz:wf [feature]
```

- **有 feature 参数**：初始化 .claude/（如未完整）+ 开发该 feature
- **无参数**：仅做 Init，补齐 .claude/ 规范文件

## Feature 列表

```
specs/
├── 6.ai-generation/    # AI 图像生成系统
├── 7.payment/          # Stripe 支付 + Credits
├── 8.dashboard/        # Dashboard 完善（T8.4 Credits 余额）
└── 9.auth-enhancement/ # Google OAuth + 邮箱验证 + 忘记密码
```

## 执行

将以下内容发送给 Claude Code（替换 `[FEATURE]` 为上面的目录名，或留空只做 Init）：

---

请调用 `gz-ai-wf` workflow 开发项目：

```
Workflow({ name: 'gz-ai-wf', args: {
  projectDir: '/Users/gz/Desktop/Advance/Task/taskaws',
  feature: '$ARGUMENTS'
}})
```

**说明**：
- `$ARGUMENTS` 是传入的 feature 目录名（如 `8.dashboard`）
- 不传 feature 时只做项目初始化（补齐 .claude/ 规范文件）
- workflow 会自动：Init 检测已有文件跳过 → Plan 读 tasks.md → 并行开发 → codex review → P0 当场修复 → 教训写入 specs/LESSONS.md
- 断点续跑：已标 `[x]` 的 task 自动跳过

**workflow vs slash command 选择**：
- 用 `/gz:wf`：任务明确、specs 齐全、不需要中途确认时（批量、省 token）
- 用 `/gz:coding`：需要随时介入调整、探索性开发时

---

**如果 `$ARGUMENTS` 为空**，则 args 中去掉 `feature` 字段，只传 `projectDir`。
