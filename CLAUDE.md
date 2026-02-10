# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Feishu/Lark (飞书) plugin for [OpenClaw](https://github.com/openclaw/openclaw).

It provides:
- Feishu channel integration (receive events, route messages, send replies/media/cards)
- Feishu tool integrations (`feishu_doc`, `feishu_app_scopes`, `feishu_wiki`, `feishu_drive`, `feishu_perm`, `feishu_bitable`)

## Development

This is a TypeScript ESM project. No build step is required - the plugin is loaded directly as `.ts` files by OpenClaw.

```bash
# Install dependencies
npm install

# Type check
npx tsc --noEmit
```

## Architecture

### Entry Point
- `index.ts` - Plugin registration entry
  - Registers Feishu channel plugin (`api.registerChannel`)
  - Registers Feishu tools (doc/wiki/drive/perm/bitable)
  - Exports public helpers (`monitorFeishuProvider`, send/media/reaction/mention utilities)

### Core Modules (src/)

**Channel Runtime (Connection + Events + Replies):**
- `channel.ts` - Main `ChannelPlugin` implementation (capabilities, config/account lifecycle, onboarding, directory, outbound, status)
- `client.ts` - Feishu SDK client factory (REST + WebSocket client + event dispatcher)
- `monitor.ts` - Event monitor bootstrap
  - Supports both `websocket` and `webhook` modes
  - Supports multi-account startup (all enabled accounts)
- `bot.ts` - Incoming event handler
  - Message deduplication
  - DM/group policy checks
  - Mention parsing and forward-mention logic
  - Inbound media/resource resolution
  - Optional dynamic agent creation for DMs
- `reply-dispatcher.ts` - Agent reply dispatch (render mode `auto/raw/card`, chunking, typing indicator integration)
- `outbound.ts` - `ChannelOutboundAdapter` implementation for text/media delivery

- `send.ts` - Text messages, interactive cards, message editing
- `media.ts` - Upload/download images and files, inbound media resource fetch

**Configuration, Accounts, Policy:**
- `config-schema.ts` - Zod schema definitions for Feishu config
  - Includes single-account + multi-account config
  - Includes tools toggles and dynamic agent creation config
- `accounts.ts` - Account resolution and merged config logic (top-level defaults + account overrides)
- `policy.ts` - DM/group allowlist and mention policy resolution
- `tools-config.ts` - Default tool switches (`doc/wiki/drive/scopes` on, `perm` off)
- `types.ts` - TypeScript types inferred from config/schema

**Feishu Tool Modules:**
- `docx.ts` / `doc-schema.ts` - Feishu document helpers and tool registration (`feishu_doc`, `feishu_app_scopes`)
- `wiki.ts` / `wiki-schema.ts` - Wiki space/node operations (`feishu_wiki`)
- `drive.ts` / `drive-schema.ts` - Drive file/folder operations (`feishu_drive`)
- `perm.ts` / `perm-schema.ts` - Drive permission member operations (`feishu_perm`)
- `bitable.ts` - Bitable tools entry export
- `bitable-tools/` - Bitable modular implementation:
  - `register.ts` tool registration + shared wrapper (`feishu_bitable_*`)
  - `schemas.ts` tool parameter schemas
  - `actions.ts` Feishu Bitable API operations
  - `meta.ts` URL parsing + app/table metadata resolution
  - `common.ts` shared types/formatting/error helpers

**Supporting Utilities:**
- `targets.ts` - Normalize `user:xxx`/`chat:xxx` target formats
- `directory.ts` - User/group lookup
- `reactions.ts` - Emoji reactions API
- `typing.ts` - Typing indicator (emoji-based)
- `probe.ts` - Bot health check
- `mention.ts` - Mention extraction/formatting and mention-forward helpers
- `dynamic-agent.ts` - Auto-create dedicated DM agents (workspace + binding updates)
- `onboarding.ts` - Channel onboarding adapter
- `runtime.ts` - Plugin runtime holder/getter

### Message Flow

1. `monitor.ts` resolves enabled account(s) and starts event listener in `websocket` or `webhook` mode.
2. Feishu event dispatcher routes `im.message.receive_v1` to `bot.ts`.
3. `bot.ts` validates policies, parses mentions/content, optionally resolves media resources.
4. `bot.ts` dispatches to OpenClaw runtime using `reply-dispatcher.ts`.
5. `reply-dispatcher.ts` chooses render path (`raw` text vs markdown card) and sends via `send.ts`.
6. For outbound tool/API calls, `outbound.ts` sends text/media through `send.ts` and `media.ts`.

### Key Configuration Options

| Option | Description |
|--------|-------------|
| `connectionMode` | `websocket` (default) or `webhook` |
| `webhookPath` / `webhookPort` | Webhook callback path/port when `connectionMode=webhook` |
| `accounts` | Multi-account config map; account config overrides top-level defaults |
| `dmPolicy` | `pairing` / `open` / `allowlist` |
| `allowFrom` | DM allowlist (required to include `"*"` when `dmPolicy=open`) |
| `groupPolicy` | `open` / `allowlist` / `disabled` |
| `groupAllowFrom` | Group sender allowlist |
| `requireMention` | Require @bot in groups (default: true) |
| `topicSessionMode` | Group topic-thread isolation (`disabled` / `enabled`) |
| `renderMode` | Reply render mode: `auto` / `raw` / `card` |
| `dynamicAgentCreation` | Auto-create isolated DM agents/workspaces |
| `tools` | Tool category switches (`doc`, `wiki`, `drive`, `perm`, `scopes`) |
| `mediaMaxMb` | Max inbound/outbound media size limit |

### Defaults and Behavior Notes

- `connectionMode` defaults to `websocket`.
- `dmPolicy` defaults to `pairing`.
- `groupPolicy` defaults to `allowlist`.
- `requireMention` defaults to `true`.
- `renderMode` behaves as `auto` when unset at runtime.
- Tool defaults:
  - `doc: true`
  - `wiki: true`
  - `drive: true`
  - `perm: false` (sensitive)
  - `scopes: true`

### Feishu SDK Usage

Uses `@larksuiteoapi/node-sdk`. Key APIs:
- `client.im.message.create/reply` - Send messages
- `client.im.message.get/patch` - Read and edit messages
- `client.im.messageResource.get` - Download media from messages
- `client.im.image.create` - Upload images
- `client.im.file.create` - Upload files
- `client.docx.*` - Document read/write and markdown conversion
- `client.wiki.*` - Wiki space/node operations
- `client.drive.*` - Drive file and permission operations
- `client.bitable.*` - Bitable metadata/record operations
- `WSClient` + `Lark.adaptDefault(...)` - WebSocket and webhook event delivery
