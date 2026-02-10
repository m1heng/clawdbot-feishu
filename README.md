# clawd-feishu

Feishu/Lark (飞书) channel plugin for [OpenClaw](https://github.com/openclaw/openclaw).

> **中文社区资料** - 配置教程、常见问题、使用技巧：[Wiki](https://github.com/m1heng/clawdbot-feishu/wiki)

[English](#english) | [中文](#中文)

---

## English

### Installation

```bash
openclaw plugins install @m1heng-clawd/feishu
```

### Upgrade

```bash
openclaw plugins update feishu
```

### Configuration

1. Create a self-built app on [Feishu Open Platform](https://open.feishu.cn)
2. Get your App ID and App Secret from the Credentials page
3. Enable required permissions (see below)
4. **Configure event subscriptions** (see below) ⚠️ Important
5. Configure the plugin:

#### Required Permissions

| Permission | Scope | Description |
|------------|-------|-------------|
| `im:message` | Messaging | Send and receive messages |
| `im:message.p2p_msg:readonly` | DM | Read direct messages to bot |
| `im:message.group_at_msg:readonly` | Group | Receive @mention messages in groups |
| `im:message:send_as_bot` | Send | Send messages as the bot |
| `im:resource` | Media | Upload and download images/files |

#### Optional Permissions

| Permission | Scope | Description |
|------------|-------|-------------|
| `contact:user.base:readonly` | User info | Get basic user info (required to resolve sender display names for speaker attribution) |
| `im:message.group_msg` | Group | Read all group messages (sensitive) |
| `im:message:readonly` | Read | Get message history |
| `im:message:update` | Edit | Update/edit sent messages |
| `im:message:recall` | Recall | Recall sent messages |
| `im:message.reactions:read` | Reactions | View message reactions |

#### Tool Permissions

**Read-only** (minimum required):

| Permission | Tool | Description |
|------------|------|-------------|
| `docx:document:readonly` | `feishu_doc` | Read documents |
| `drive:drive:readonly` | `feishu_drive` | List folders, get file info |
| `wiki:wiki:readonly` | `feishu_wiki` | List spaces, list nodes, get node info, search |
| `bitable:app:readonly` | `feishu_bitable` | Read bitable records and fields |

**Read-write** (optional, for create/edit/delete operations):

| Permission | Tool | Description |
|------------|------|-------------|
| `docx:document` | `feishu_doc` | Create/edit documents |
| `docx:document.block:convert` | `feishu_doc` | Markdown to blocks conversion (required for write/append) |
| `drive:drive` | `feishu_doc`, `feishu_drive` | Upload images to documents, create folders, move/delete files |
| `wiki:wiki` | `feishu_wiki` | Create/move/rename wiki nodes |
| `bitable:app` | `feishu_bitable` | Create/update bitable records |

#### Drive Access ⚠️

> **Important:** Bots don't have their own "My Space" (root folder). Bots can only access files/folders that have been **shared with them**.

To let the bot manage files:
1. Create a folder in your Feishu Drive
2. Right-click the folder → **Share** → search for your bot name
3. Grant appropriate permission (view/edit)

Without this step, `feishu_drive` operations like `create_folder` will fail because the bot has no root folder to create in.

#### Wiki Space Access ⚠️

> **Important:** API permissions alone are not enough for wiki access. You must also add the bot to each wiki space.

1. Open the wiki space you want the bot to access
2. Click **Settings** (gear icon) → **Members**
3. Click **Add Member** → search for your bot name
4. Select appropriate permission level (view/edit)

Without this step, `feishu_wiki` will return empty results even with correct API permissions.

Reference: [Wiki FAQ - How to add app to wiki](https://open.feishu.cn/document/server-docs/docs/wiki-v2/wiki-qa#a40ad4ca)

#### Bitable Access ⚠️

> **Important:** Like other resources, the bot can only access bitables that have been **shared with it**.

To let the bot access a bitable:
1. Open the bitable you want the bot to access
2. Click **Share** button → search for your bot name
3. Grant appropriate permission (view/edit)

The `feishu_bitable` tools support both URL formats:
- `/base/XXX?table=YYY` - Standard bitable URL
- `/wiki/XXX?table=YYY` - Bitable embedded in wiki (auto-converts to app_token)

#### Event Subscriptions ⚠️

> **This is the most commonly missed configuration!** If the bot can send messages but cannot receive them, check this section.

In the Feishu Open Platform console, go to **Events & Callbacks**:

1. **Event configuration**: Select the subscription mode matching your `connectionMode`:
   - **Long connection** — for `connectionMode: "websocket"` (recommended, no public URL needed)
   - **Request URL** — for `connectionMode: "webhook"` (requires a publicly accessible URL)
2. **Add event subscriptions**:

| Event | Description |
|-------|-------------|
| `im.message.receive_v1` | Receive messages (required) |
| `im.message.message_read_v1` | Message read receipts |
| `im.chat.member.bot.added_v1` | Bot added to group |
| `im.chat.member.bot.deleted_v1` | Bot removed from group |

3. Ensure the event permissions are approved

```bash
openclaw config set channels.feishu.appId "cli_xxxxx"
openclaw config set channels.feishu.appSecret "your_app_secret"
openclaw config set channels.feishu.enabled true
```

### Configuration Options

```yaml
channels:
  feishu:
    enabled: true
    appId: "cli_xxxxx"
    appSecret: "secret"
    # Domain: "feishu" (China), "lark" (International), or custom URL
    domain: "feishu"  # or "https://open.xxx.cn" for private deployment
    # Connection mode: "websocket" (recommended) or "webhook"
    connectionMode: "websocket"
    # DM policy: "pairing" | "open" | "allowlist"
    dmPolicy: "pairing"
    # Group policy: "open" | "allowlist" | "disabled"
    groupPolicy: "allowlist"
    # Require @mention in groups
    requireMention: true
    # Max media size in MB (default: 30)
    mediaMaxMb: 30
    # Render mode for bot replies: "auto" | "raw" | "card"
    renderMode: "auto"
```

#### Connection Mode

Two connection modes are available for receiving events from Feishu:

| Mode | Description |
|------|-------------|
| `websocket` | (Default, recommended) Long-polling WebSocket connection. No public URL required, works behind NAT/firewall. Best for local development and most deployments. |
| `webhook` | HTTP server that receives event callbacks. Requires a publicly accessible URL. Suitable for server deployments behind a reverse proxy (e.g. Nginx). |

**WebSocket mode** (default, no extra config needed):

```yaml
channels:
  feishu:
    connectionMode: "websocket"  # or just omit this line
```

In Feishu console: Events & Callbacks → select **Long connection**.

**Webhook mode**:

```yaml
channels:
  feishu:
    connectionMode: "webhook"
    webhookPort: 3000               # HTTP server port (default: 3000)
    webhookPath: "/feishu/events"   # Event callback path (default: "/feishu/events")
    encryptKey: "your_encrypt_key"           # From Feishu console → Events & Callbacks → Encrypt Key
    verificationToken: "your_verify_token"   # From Feishu console → Events & Callbacks → Verification Token
```

In Feishu console: Events & Callbacks → select **Request URL** → set the URL to:

```
https://your-domain.com/feishu/events
```

> **Note:** The Request URL must be HTTPS and publicly accessible. For local development, you can use tools like [ngrok](https://ngrok.com) to create a tunnel: `ngrok http 3000`, then use the generated URL.

#### Render Mode

| Mode | Description |
|------|-------------|
| `auto` | (Default) Automatically detect: use card for messages with code blocks or tables, plain text otherwise. |
| `raw` | Always send replies as plain text. Markdown tables are converted to ASCII. |
| `card` | Always send replies as interactive cards with full markdown rendering (syntax highlighting, tables, clickable links). |

#### Dynamic Agent Creation (Multi-User Workspace Isolation)

When enabled, each DM user automatically gets their own isolated agent instance with a dedicated workspace. This provides complete isolation including separate conversation history, memory (MEMORY.md), and workspace files.

```yaml
channels:
  feishu:
    dmPolicy: "open"
    allowFrom: ["*"]
    dynamicAgentCreation:
      enabled: true
      # Template for workspace directory ({userId} = OpenID, {agentId} = generated agent ID)
      workspaceTemplate: "~/workspaces/feishu-{agentId}"
      # Template for agent config directory
      agentDirTemplate: "~/.openclaw/agents/{agentId}/agent"
      # Optional: limit total number of dynamic agents
      maxAgents: 100

session:
  # Also set dmScope for session isolation (conversation history)
  dmScope: "per-peer"
```

| Option | Description |
|--------|-------------|
| `enabled` | Enable dynamic agent creation for DM users |
| `workspaceTemplate` | Template for workspace path. Supports `{userId}` (OpenID) and `{agentId}` (= `feishu-{openId}`) |
| `agentDirTemplate` | Template for agent directory path |
| `maxAgents` | Optional limit on number of dynamic agents |

**How it works:**
1. When a new user sends a DM, the system creates a new agent entry in `openclaw.json`
2. A binding is created to route that user's DM to their dedicated agent
3. Workspace and agent directories are created automatically
4. Subsequent messages from that user go to their isolated agent

**Difference from `dmScope: "per-peer"`:**
- `dmScope: "per-peer"` only isolates conversation history
- `dynamicAgentCreation` provides full isolation (workspace, memory, identity, tools)

### Features

- WebSocket and Webhook connection modes
- Direct messages and group chats
- Message replies and quoted message context
- **Inbound media support**: AI can see images, read files (PDF, Excel, etc.), and process rich text with embedded images
- Image and file uploads (outbound)
- Typing indicator (via emoji reactions)
- Pairing flow for DM approval
- User and group directory lookup
- **Card render mode**: Optional markdown rendering with syntax highlighting
- **Document tools**: Read, create, and write Feishu documents with markdown (tables not supported due to API limitations)
- **Wiki tools**: Navigate knowledge bases, list spaces, get node details, search, create/move/rename nodes
- **Drive tools**: List folders, get file info, create folders, move/delete files
- **Bitable tools**: Read/write bitable (多维表格) records, supports both `/base/` and `/wiki/` URLs
- **@mention forwarding**: When you @mention someone in your message, the bot's reply will automatically @mention them too
- **Permission error notification**: When the bot encounters a Feishu API permission error, it automatically notifies the user with the permission grant URL
- **Dynamic agent creation**: Each DM user can have their own isolated agent instance with dedicated workspace (optional)

#### @Mention Forwarding

When you want the bot to @mention someone in its reply, simply @mention them in your message:

- **In DM**: `@张三 say hello` → Bot replies with `@张三 Hello!`
- **In Group**: `@bot @张三 say hello` → Bot replies with `@张三 Hello!`

The bot automatically detects @mentions in your message and includes them in its reply. No extra permissions required beyond the standard messaging permissions.

### FAQ

#### Bot cannot receive messages

Check the following:
1. Have you configured **event subscriptions**? (See Event Subscriptions section)
2. Does the event subscription mode match your `connectionMode`?
   - `websocket` → **Long connection** in Feishu console
   - `webhook` → **Request URL** in Feishu console (URL must be reachable)
3. Did you add the `im.message.receive_v1` event?
4. Are the permissions approved?
5. For webhook mode: is your server running and the URL publicly accessible?

#### 403 error when sending messages

Ensure `im:message:send_as_bot` permission is approved.

#### How to clear history / start new conversation

Send `/new` command in the chat.

#### Why is the output not streaming

Feishu API has rate limits. Streaming updates can easily trigger throttling. We use complete-then-send approach for stability.

#### Windows install error `spawn npm ENOENT`

If `openclaw plugins install` fails, install manually:

```bash
# 1. Download the package
curl -O https://registry.npmjs.org/@m1heng-clawd/feishu/-/feishu-0.1.3.tgz

# 2. Install from local file
openclaw plugins install ./feishu-0.1.3.tgz
```

#### Cannot find the bot in Feishu

1. Ensure the app is published (at least to test version)
2. Search for the bot name in Feishu search box
3. Check if your account is in the app's availability scope

---

## 中文

### 安装

```bash
openclaw plugins install @m1heng-clawd/feishu
```

### 升级

```bash
openclaw plugins update feishu
```

### 配置

1. 在 [飞书开放平台](https://open.feishu.cn) 创建自建应用
2. 在凭证页面获取 App ID 和 App Secret
3. 开启所需权限（见下方）
4. **配置事件订阅**（见下方）⚠️ 重要
5. 配置插件：

#### 必需权限

| 权限 | 范围 | 说明 |
|------|------|------|
| `im:message` | 消息 | 发送和接收消息 |
| `im:message.p2p_msg:readonly` | 私聊 | 读取发给机器人的私聊消息 |
| `im:message.group_at_msg:readonly` | 群聊 | 接收群内 @机器人 的消息 |
| `im:message:send_as_bot` | 发送 | 以机器人身份发送消息 |
| `im:resource` | 媒体 | 上传和下载图片/文件 |

#### 可选权限

| 权限 | 范围 | 说明 |
|------|------|------|
| `contact:user.base:readonly` | 用户信息 | 获取用户基本信息（用于解析发送者姓名，避免群聊/私聊把不同人当成同一说话者） |
| `im:message.group_msg` | 群聊 | 读取所有群消息（敏感） |
| `im:message:readonly` | 读取 | 获取历史消息 |
| `im:message:update` | 编辑 | 更新/编辑已发送消息 |
| `im:message:recall` | 撤回 | 撤回已发送消息 |
| `im:message.reactions:read` | 表情 | 查看消息表情回复 |

#### 工具权限

**只读权限**（最低要求）：

| 权限 | 工具 | 说明 |
|------|------|------|
| `docx:document:readonly` | `feishu_doc` | 读取文档 |
| `drive:drive:readonly` | `feishu_drive` | 列出文件夹、获取文件信息 |
| `wiki:wiki:readonly` | `feishu_wiki` | 列出空间、列出节点、获取节点详情、搜索 |
| `bitable:app:readonly` | `feishu_bitable` | 读取多维表格记录和字段 |

**读写权限**（可选，用于创建/编辑/删除操作）：

| 权限 | 工具 | 说明 |
|------|------|------|
| `docx:document` | `feishu_doc` | 创建/编辑文档 |
| `docx:document.block:convert` | `feishu_doc` | Markdown 转 blocks（write/append 必需） |
| `drive:drive` | `feishu_doc`, `feishu_drive` | 上传图片到文档、创建文件夹、移动/删除文件 |
| `wiki:wiki` | `feishu_wiki` | 创建/移动/重命名知识库节点 |
| `bitable:app` | `feishu_bitable` | 创建/更新多维表格记录 |

#### 云空间访问权限 ⚠️

> **重要：** 机器人没有自己的"我的空间"（根目录）。机器人只能访问**被分享给它的文件/文件夹**。

要让机器人管理文件：
1. 在你的飞书云空间创建一个文件夹
2. 右键文件夹 → **分享** → 搜索机器人名称
3. 授予相应权限（查看/编辑）

如果不做这一步，`feishu_drive` 的 `create_folder` 等操作会失败，因为机器人没有根目录可以创建文件夹。

#### 知识库空间权限 ⚠️

> **重要：** 仅有 API 权限不够，还需要将机器人添加到知识库空间。

1. 打开需要机器人访问的知识库空间
2. 点击 **设置**（齿轮图标）→ **成员管理**
3. 点击 **添加成员** → 搜索机器人名称
4. 选择权限级别（查看/编辑）

如果不做这一步，即使 API 权限正确，`feishu_wiki` 也会返回空结果。

参考文档：[知识库常见问题 - 如何将应用添加为知识库成员](https://open.feishu.cn/document/server-docs/docs/wiki-v2/wiki-qa#a40ad4ca)

#### 多维表格访问权限 ⚠️

> **重要：** 与其他资源一样，机器人只能访问**被分享给它的多维表格**。

要让机器人访问多维表格：
1. 打开需要机器人访问的多维表格
2. 点击 **分享** 按钮 → 搜索机器人名称
3. 授予相应权限（查看/编辑）

`feishu_bitable` 工具支持两种 URL 格式：
- `/base/XXX?table=YYY` - 标准多维表格链接
- `/wiki/XXX?table=YYY` - 嵌入在知识库中的多维表格（自动转换为 app_token）

#### 事件订阅 ⚠️

> **这是最容易遗漏的配置！** 如果机器人能发消息但收不到消息，请检查此项。

在飞书开放平台的应用后台，进入 **事件与回调** 页面：

1. **事件配置方式**：根据你的 `connectionMode` 选择对应的订阅方式：
   - **使用长连接接收事件** — 对应 `connectionMode: "websocket"`（推荐，无需公网地址）
   - **使用请求地址接收事件** — 对应 `connectionMode: "webhook"`（需要公网可访问的 URL）
2. **添加事件订阅**，勾选以下事件：

| 事件 | 说明 |
|------|------|
| `im.message.receive_v1` | 接收消息（必需） |
| `im.message.message_read_v1` | 消息已读回执 |
| `im.chat.member.bot.added_v1` | 机器人进群 |
| `im.chat.member.bot.deleted_v1` | 机器人被移出群 |

3. 确保事件订阅的权限已申请并通过审核

```bash
openclaw config set channels.feishu.appId "cli_xxxxx"
openclaw config set channels.feishu.appSecret "your_app_secret"
openclaw config set channels.feishu.enabled true
```

### 配置选项

```yaml
channels:
  feishu:
    enabled: true
    appId: "cli_xxxxx"
    appSecret: "secret"
    # 域名: "feishu" (国内)、"lark" (国际) 或自定义 URL
    domain: "feishu"  # 私有化部署可用 "https://open.xxx.cn"
    # 连接模式: "websocket" (推荐) 或 "webhook"
    connectionMode: "websocket"
    # 私聊策略: "pairing" | "open" | "allowlist"
    dmPolicy: "pairing"
    # 群聊策略: "open" | "allowlist" | "disabled"
    groupPolicy: "allowlist"
    # 群聊是否需要 @机器人
    requireMention: true
    # 媒体文件最大大小 (MB, 默认 30)
    mediaMaxMb: 30
    # 回复渲染模式: "auto" | "raw" | "card"
    renderMode: "auto"
```

#### 连接模式

支持两种从飞书接收事件的连接模式：

| 模式 | 说明 |
|------|------|
| `websocket` | （默认，推荐）长连接 WebSocket 模式。无需公网地址，可在 NAT/防火墙后使用。适合本地开发和大部分部署场景。 |
| `webhook` | HTTP 服务器接收事件回调。需要公网可访问的 URL。适合通过反向代理（如 Nginx）部署的服务器环境。 |

**WebSocket 模式**（默认，无需额外配置）：

```yaml
channels:
  feishu:
    connectionMode: "websocket"  # 或直接省略此行
```

飞书控制台：事件与回调 → 选择 **使用长连接接收事件**。

**Webhook 模式**：

```yaml
channels:
  feishu:
    connectionMode: "webhook"
    webhookPort: 3000               # HTTP 服务端口（默认: 3000）
    webhookPath: "/feishu/events"   # 事件回调路径（默认: "/feishu/events"）
    encryptKey: "your_encrypt_key"           # 飞书控制台 → 事件与回调 → Encrypt Key
    verificationToken: "your_verify_token"   # 飞书控制台 → 事件与回调 → Verification Token
```

飞书控制台：事件与回调 → 选择 **使用请求地址接收事件** → 填入请求地址：

```
https://your-domain.com/feishu/events
```

> **提示：** 请求地址必须是 HTTPS 且公网可访问。本地开发时，可使用 [ngrok](https://ngrok.com) 等工具创建隧道：`ngrok http 3000`，然后使用生成的地址。

#### 渲染模式

| 模式 | 说明 |
|------|------|
| `auto` | （默认）自动检测：有代码块或表格时用卡片，否则纯文本 |
| `raw` | 始终纯文本，表格转为 ASCII |
| `card` | 始终使用卡片，支持语法高亮、表格、链接等 |

#### 动态 Agent 创建（多用户 Workspace 隔离）

启用后，每个私聊用户会自动获得独立的 agent 实例和专属 workspace。这提供完整的隔离，包括独立的对话历史、记忆（MEMORY.md）和工作区文件。

```yaml
channels:
  feishu:
    dmPolicy: "open"
    allowFrom: ["*"]
    dynamicAgentCreation:
      enabled: true
      # workspace 目录模板 ({userId} = OpenID, {agentId} = 生成的 agent ID)
      workspaceTemplate: "~/workspaces/feishu-{agentId}"
      # agent 配置目录模板
      agentDirTemplate: "~/.openclaw/agents/{agentId}/agent"
      # 可选：限制动态 agent 总数
      maxAgents: 100

session:
  # 同时设置 dmScope 以隔离对话历史
  dmScope: "per-peer"
```

| 选项 | 说明 |
|------|------|
| `enabled` | 是否为私聊用户启用动态 agent 创建 |
| `workspaceTemplate` | workspace 路径模板，支持 `{userId}`（OpenID）和 `{agentId}`（= `feishu-{openId}`）|
| `agentDirTemplate` | agent 目录路径模板 |
| `maxAgents` | 可选，限制动态 agent 的最大数量 |

**工作原理：**
1. 当新用户发送私聊时，系统在 `openclaw.json` 中创建新的 agent 条目
2. 创建 binding 将该用户的私聊路由到专属 agent
3. 自动创建 workspace 和 agent 目录
4. 该用户后续的消息都会路由到其隔离的 agent

**与 `dmScope: "per-peer"` 的区别：**
- `dmScope: "per-peer"` 仅隔离对话历史
- `dynamicAgentCreation` 提供完整隔离（workspace、记忆、身份、工具）

### 功能

- WebSocket 和 Webhook 连接模式
- 私聊和群聊
- 消息回复和引用上下文
- **入站媒体支持**：AI 可以看到图片、读取文件（PDF、Excel 等）、处理富文本中的嵌入图片
- 图片和文件上传（出站）
- 输入指示器（通过表情回复实现）
- 私聊配对审批流程
- 用户和群组目录查询
- **卡片渲染模式**：支持语法高亮的 Markdown 渲染
- **文档工具**：读取、创建、用 Markdown 写入飞书文档（表格因 API 限制不支持）
- **知识库工具**：浏览知识库、列出空间、获取节点详情、搜索、创建/移动/重命名节点
- **云空间工具**：列出文件夹、获取文件信息、创建文件夹、移动/删除文件
- **多维表格工具**：读写多维表格记录，支持 `/base/` 和 `/wiki/` 两种链接格式
- **@ 转发功能**：在消息中 @ 某人，机器人的回复会自动 @ 该用户
- **权限错误提示**：当机器人遇到飞书 API 权限错误时，会自动通知用户并提供权限授权链接
- **动态 Agent 创建**：每个私聊用户可拥有独立的 agent 实例和专属 workspace（可选）

#### @ 转发功能

如果你希望机器人的回复中 @ 某人，只需在你的消息中 @ 他们：

- **私聊**：`@张三 跟他问好` → 机器人回复 `@张三 你好！`
- **群聊**：`@机器人 @张三 跟他问好` → 机器人回复 `@张三 你好！`

机器人会自动检测消息中的 @ 并在回复时带上。无需额外权限。

### 常见问题

#### 机器人收不到消息

检查以下配置：
1. 是否配置了 **事件订阅**？（见上方事件订阅章节）
2. 事件订阅方式是否与 `connectionMode` 匹配？
   - `websocket` → 飞书控制台选择 **使用长连接接收事件**
   - `webhook` → 飞书控制台选择 **使用请求地址接收事件**（URL 必须可访问）
3. 是否添加了 `im.message.receive_v1` 事件？
4. 相关权限是否已申请并审核通过？
5. 如果使用 webhook 模式：服务是否正在运行？URL 是否公网可访问？

#### 返回消息时 403 错误

确保已申请 `im:message:send_as_bot` 权限，并且权限已审核通过。

#### 如何清理历史会话 / 开启新对话

在聊天中发送 `/new` 命令即可开启新对话。

#### 消息为什么不是流式输出

飞书 API 有请求频率限制，流式更新消息很容易触发限流。当前采用完整回复后一次性发送的方式，以保证稳定性。

#### Windows 安装报错 `spawn npm ENOENT`

如果 `openclaw plugins install` 失败，可以手动安装：

```bash
# 1. 下载插件包
curl -O https://registry.npmjs.org/@m1heng-clawd/feishu/-/feishu-0.1.3.tgz

# 2. 从本地安装
openclaw plugins install ./feishu-0.1.3.tgz
```

#### 在飞书里找不到机器人

1. 确保应用已发布（至少发布到测试版本）
2. 在飞书搜索框中搜索机器人名称
3. 检查应用可用范围是否包含你的账号

---

## License

MIT
