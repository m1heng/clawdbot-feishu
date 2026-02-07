# LarkClaw (Feishu/Lark for OpenClaw)

本项目是 OpenClaw 的飞书/Lark 渠道插件的 **fork 版本**，上游来源：
- https://github.com/m1heng/clawdbot-feishu

本仓库在上游基础上重点增强 **卡片渲染体验**（标题状态、多色、流式更新、工具过程、折叠面板等），并保留上游全部基础能力。

---

## 相对上游的新增

- **工具过程展示**（告别长时间空屏等待）
- **卡片标题多状态/多颜色**（思考中/调用工具中/完成/异常等）
- **流式更新同一条卡片**（内置节流，避免频率限制）
- **结束后折叠工具过程面板**（突出最终答案）
- 新增 **renderEngine**，可选择 `simple`/`agent-card` 渲染器
- **Outbound 推送支持卡片**（cron/主动推送也可富文本渲染）

示例：
工具调用中：
<img width="1320" height="286" alt="image" src="https://github.com/user-attachments/assets/d4212252-b591-449b-b53e-dd8e44bec915" />

执行完成（过程自动折叠，点击展开）：
<img width="1330" height="598" alt="image" src="https://github.com/user-attachments/assets/3b8a2a53-6c8f-4184-8f61-d4a225bdea70" />

---

## 安装方式（推荐：先装上游，再切到本地仓库）

### 1) 先安装上游包

```bash
openclaw plugins install @m1heng-clawd/feishu
```

### 2) 切换为本地仓库代码（启用增强能力）

**方式 A：本地路径安装（推荐）**

```bash
openclaw plugins install /path/to/LarkClaw
```

**方式 B：直接覆盖插件目录**

把本仓库内容覆盖到 OpenClaw 扩展目录（例如）：

```
/home/ecs-user/.clawdbot/extensions/feishu
```

然后重启 OpenClaw。

---

## 配置（启用增强渲染）

新增渲染器开关 `renderEngine`：

```yaml
channels:
  feishu:
    renderEngine: agent-card
    # 可选：强制卡片渲染
    renderMode: card
```

同时必须在 `openclaw.json` 中开启（否则 tools 调用过程不会输出）：

```yaml
agents:
  defaults:
    verboseDefault: on
```

说明：
- `renderEngine`: `simple`（默认，上游逻辑） / `agent-card`（增强渲染）
- `renderMode`: `auto` / `raw` / `card`，主要影响 `simple` 引擎
- outbound（cron/主动推送）会遵循 `renderMode` 发送卡片

---

## 快速配置示例

```bash
openclaw config set channels.feishu.appId "cli_xxxxx"
openclaw config set channels.feishu.appSecret "your_app_secret"
openclaw config set channels.feishu.enabled true
openclaw config set channels.feishu.renderEngine "agent-card"
openclaw config set channels.feishu.renderMode "card"
```

---

## License

MIT
