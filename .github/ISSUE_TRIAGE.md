# Issue Triage Playbook

[English](#english) | [中文](#中文)

---

## English

### Goal

Keep issue handling fast and reproducible with manual triage in the first phase.

### Label Taxonomy

- `type:*`: bug/config/feature/docs/question
- `area:*`: channel/tools/docs (optional, maintainer-applied)

### Definition of Ready (for engineering)

Issue is ready when core context is present:

1. OpenClaw version
2. Feishu plugin version
3. Setup method (`openclaw.json` manual / command / onboarding/UI)
4. Repro steps (for bug/config issues)
5. Logs around startup and failure window (optional, if available)

If core context is missing, ask the reporter for the missing details.

### Manual Triage Flow (v1)

1. Confirm issue type and apply `type:*` label.
2. Ask for missing context if needed.
3. Reproduce and track progress manually in comments.

### Maintainer Reply Template (missing info)

```text
Thanks for the report. To reproduce this reliably, please add:
1) OpenClaw version
2) Feishu plugin version
3) Setup method (manual openclaw.json / command / onboarding/UI)
4) Repro steps
5) Relevant startup/runtime logs around the failure (optional, if available)

After these are provided, we'll continue triage.
```

---

## 中文

### 目标

第一阶段采用手动分诊，提升反馈处理效率与可复现性。

### 标签体系

- `type:*`：问题类型（bug/config/feature/docs/question）
- `area:*`：模块标签（channel/tools/docs，可选，由维护者添加）

### 进入开发前标准（Definition of Ready）

以下核心信息齐全即可进入工程排查：

1. OpenClaw 版本
2. 飞书插件版本
3. 配置方式（手工 `openclaw.json` / 命令行 / onboarding 或 UI）
4. 可复现步骤（Bug/配置类 issue）
5. 启动日志 + 复现窗口日志（可选，若有请提供）

若核心信息缺失，请在评论中向提问者补充收集。

### 手动分诊流程（v1）

1. 确认问题类型并添加 `type:*` 标签。
2. 如信息不足，评论追问关键上下文。
3. 复现与进展先通过评论手动跟踪。

### 维护者快捷回复模板（信息不足）

```text
感谢反馈。为了稳定复现，请补充以下信息：
1）OpenClaw 版本
2）飞书插件版本
3）配置方式（手工 openclaw.json / 命令行 / onboarding 或 UI）
4）可复现步骤
5）故障前后相关启动/运行日志（可选，若有请提供）

补充后我们会继续跟进。
```
