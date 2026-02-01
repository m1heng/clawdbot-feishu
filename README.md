# LarkClaw (Feishu/Lark for OpenClaw)

本项目是 OpenClaw 的飞书/Lark 渠道插件的 **fork 版本**，上游来源：
- https://github.com/m1heng/clawdbot-feishu

本仓库在上游基础上重点增强 **卡片渲染体验**（标题状态、多色、流式更新、verbose 工具过程、折叠面板等），并保留上游全部基础能力。

---

## 你会得到什么（相对上游的新增）

- **卡片标题多状态/多颜色**（思考中/调用工具中/完成/异常）
- **流式更新同一条卡片**（防刷屏 + 节流）
- **verbose 工具调用过程展示**（思考、工具调用、耗时、结果）
- **结束后自动折叠工具过程面板**（清爽显示最终答案）
- 保留上游的 `auto/raw/card` 渲染模式，并新增 **renderEngine** 可选渲染器

---

## 安装方式（推荐：先装上游，再切到本地仓库）

### 1) 先安装上游包（和你现有方式一致）

```bash
openclaw plugins install @m1heng-clawd/feishu
```

### 2) 切换为本地仓库代码（启用本仓库增强能力）

两种方式任选一种：

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

新增的渲染器开关是 **renderEngine**，你需要显式开启：

```yaml
channels:
  feishu:
    renderEngine: agent-card
    # 可选：强制卡片渲染
    renderMode: card
```

说明：
- `renderEngine`: `simple`（默认，上游逻辑） / `agent-card`（增强渲染）
- `renderMode`: `auto` / `raw` / `card`，只影响 `simple` 引擎下的发送方式

---

## 使用说明（简版）

1. 在飞书开放平台创建自建应用，获取 `App ID` / `App Secret`
2. 配置事件订阅（长连接推荐）
3. 在 OpenClaw 里配置：

```bash
openclaw config set channels.feishu.appId "cli_xxxxx"
openclaw config set channels.feishu.appSecret "your_app_secret"
openclaw config set channels.feishu.enabled true
openclaw config set channels.feishu.renderEngine "agent-card"
openclaw config set channels.feishu.renderMode "card"
```

---

## 备注

- 飞书对卡片更新有频率限制，本仓库已内置 **节流更新**
- verbose 过程展示需要 OpenClaw 在回复 payload 中带出 tool/assistant stream 数据

---

## 上游功能仍然完整保留

- WebSocket / Webhook 连接
- 私聊/群聊、@mention 转发
- 图片/文件上传、文档工具
- 事件订阅、权限配置等

---

## License

MIT
