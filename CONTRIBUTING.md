# Contributing to clawdbot-feishu

[English](#english) | [中文](#中文)

---

## English

OpenClaw references:
- https://github.com/openclaw/openclaw/blob/main/README.md
- https://github.com/m1heng/clawdbot-feishu/blob/main/README.md

### How to Contribute

- Open an Issue to report bugs (with reproducible steps and logs).
- Open an Issue to discuss new feature ideas.
- Submit a Pull Request to fix bugs, add features, or improve docs.
- Help review PRs and verify fixes from other contributors.

### Issue Reporting Standard

Use the GitHub Issue Forms and pick the correct type:

- `Bug Report / 缺陷反馈`
- `Config or Integration Issue / 配置或接入问题`
- `Feature Request / 功能建议`
- `Documentation Improvement / 文档改进`
- `Question / 使用咨询`

For usage questions, please use:

- Open `Question` issue for troubleshooting with logs/config details.

For bug/config issues, include this recommended context:

- OpenClaw version
- Feishu plugin version
- Setup method (`openclaw.json` manual edit / CLI command / onboarding/UI)
- Repro steps
- Relevant startup and runtime logs

Recommended commands to collect environment details:

```bash
openclaw --version
openclaw plugins list | rg -i feishu
node -v
```

### Development requirements

- Node.js `>= 22` (matches OpenClaw development requirement)
- `pnpm` (recommended for OpenClaw source workflow)
- `npm` (used in this plugin repo for dependency install)

Quick check:

```bash
node -v
pnpm -v
```

### Recommended local setup (OpenClaw source-first)

1. Clone OpenClaw.

```bash
git clone https://github.com/openclaw/openclaw.git
cd openclaw
```

2. Start OpenClaw from source.

```bash
pnpm install
pnpm ui:build
pnpm build
pnpm openclaw onboard --install-daemon
pnpm gateway:watch
```

3. Clone this plugin and install dependencies.

```bash
git clone https://github.com/m1heng/clawdbot-feishu.git
cd clawdbot-feishu
npm install
```

4. Connect local `clawdbot-feishu` to local OpenClaw.

Use `-l` with the correct plugin path (relative or absolute).  
The path should point to the repository root containing `openclaw.plugin.json` and `index.ts`.

```bash
pnpm openclaw plugins install -l /path/to/clawdbot-feishu
```

Example:

```bash
pnpm openclaw plugins install -l /Users/myclaw/github/claw/clawdbot-feishu
```

5. Configure Feishu credentials in OpenClaw.

If `pnpm openclaw onboard` already set these values in your environment, you can skip this step.

```bash
pnpm openclaw config set channels.feishu.appId "cli_xxxxx"
pnpm openclaw config set channels.feishu.appSecret "your_app_secret"
pnpm openclaw config set channels.feishu.enabled true
```

For required permissions and event subscription details, see `README.md`.

### Local debug loop

- After each plugin code change, restart OpenClaw gateway.
- Re-verify the most basic flow and the feature you fixed or added.

Gateway restart example:

```bash
# stop current gateway process (Ctrl+C), then run again
pnpm openclaw gateway
```

### Before You PR

- Keep the PR focused on one problem.
- Explain what changed and why it is needed.
- Call out behavior/config changes clearly.
- Provide verification steps and results (basic flow + your changed feature).
- Include logs/screenshots when they help review.
- Do not include secrets or sensitive data in commits/logs.

### Quick troubleshooting

- Can send but cannot receive: check `im.message.receive_v1` subscription and ensure Feishu event mode matches `connectionMode`.
- `403` on send: check `im:message:send_as_bot` permission approval.
- Wiki/Drive/Bitable returns empty: ensure the bot is added/shared to target resources.
- Webhook local debug: callback URL must be public HTTPS; use tunnel tools such as `ngrok` if needed.

### Documentation feedback

This project is evolving quickly. If any instruction in this document is inaccurate or does not work in your environment, please open an Issue or PR with your environment details, steps, and logs.

---

## 中文

OpenClaw 参考文档：
- https://github.com/openclaw/openclaw/blob/main/README.md
- https://github.com/m1heng/clawdbot-feishu/blob/main/README.md

### 贡献方式

- 提交 Issue 反馈问题（附复现步骤和日志）。
- 提交 Issue 讨论新功能需求。
- 提交 Pull Request 修复 Bug、增加功能或改进文档。
- 参与 PR 评审，协助验证其他贡献者的修复。

### Issue 反馈规范

请优先使用 GitHub Issue Forms，并选择正确类型：

- `Bug Report / 缺陷反馈`
- `Config or Integration Issue / 配置或接入问题`
- `Feature Request / 功能建议`
- `Documentation Improvement / 文档改进`
- `Question / 使用咨询`

使用咨询请使用：

- 需要日志/配置排查时，提交 `Question` Issue。

对于 Bug/配置问题，建议提供以下信息：

- OpenClaw 版本
- 飞书插件版本
- 配置方式（手工 `openclaw.json` / 命令行 / onboarding 或 UI）
- 可复现步骤
- 相关启动日志和运行日志

建议用于采集环境信息的命令：

```bash
openclaw --version
openclaw plugins list | rg -i feishu
node -v
```

### 开发环境要求

- Node.js `>= 22`（与 OpenClaw 开发要求一致）
- `pnpm`（推荐用于 OpenClaw 源码开发流程）
- `npm`（本插件仓库用于安装依赖）

快速检查：

```bash
node -v
pnpm -v
```

### 推荐本地开发方式（默认 OpenClaw 源码联调）

1. 先 clone `openclaw`。

```bash
git clone https://github.com/openclaw/openclaw.git
cd openclaw
```

2. 按源码方式启动 OpenClaw。

```bash
pnpm install
pnpm ui:build
pnpm build
pnpm openclaw onboard --install-daemon
pnpm gateway:watch
```

3. clone 本仓库并安装依赖。

```bash
git clone https://github.com/m1heng/clawdbot-feishu.git
cd clawdbot-feishu
npm install
```

4. 将本地 `clawdbot-feishu` 连接到本地 OpenClaw。

请使用 `-l` 参数并传入插件仓库的正确路径（相对路径或绝对路径均可）。  
该路径应指向包含 `openclaw.plugin.json` 和 `index.ts` 的仓库根目录。

```bash
pnpm openclaw plugins install -l /path/to/clawdbot-feishu
```

示例：

```bash
pnpm openclaw plugins install -l /Users/myclaw/github/claw/clawdbot-feishu
```

5. 在 OpenClaw 里配置飞书凭证。

如果你在 `pnpm openclaw onboard` 阶段已经配置好这些参数，可跳过此步骤。

```bash
pnpm openclaw config set channels.feishu.appId "cli_xxxxx"
pnpm openclaw config set channels.feishu.appSecret "your_app_secret"
pnpm openclaw config set channels.feishu.enabled true
```

飞书权限和事件订阅配置请参考 `README.md`。

### 本地调试闭环

- 每次更改插件代码后，重启 OpenClaw gateway。
- 回归验证最基本功能，以及你修复或新增的功能。

Gateway 重启示例：

```bash
# 先停止当前 gateway 进程（Ctrl+C），再重新启动
pnpm openclaw gateway
```

### Before You PR（提交前检查）

- PR 聚焦单一问题，避免一次性混入太多无关改动。
- 说明改了什么、为什么改。
- 明确标注行为变化或配置变化。
- 给出验证步骤和结果（最基本流程 + 你改动的功能）。
- 必要时附上日志或截图，便于评审。
- 提交内容和日志中不包含密钥等敏感信息。

### 快速排查

- 能发不能收：检查是否订阅 `im.message.receive_v1`，并确认飞书事件订阅模式与 `connectionMode` 一致。
- 发送报 `403`：检查 `im:message:send_as_bot` 是否已通过审批。
- Wiki/Drive/Bitable 结果为空：检查是否已将机器人加入对应资源并授权。
- Webhook 本地调试：回调地址必须是公网 HTTPS，可用 `ngrok` 等隧道工具。

### 文档反馈声明

本项目处于快速迭代阶段。如果你发现本文档描述不准确、步骤不生效，欢迎提交 Issue 或 PR，附上你的环境信息、复现步骤和日志，我们会尽快修正。
