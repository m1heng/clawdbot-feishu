# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Feishu/Lark (飞书) channel plugin for [OpenClaw](https://github.com/openclaw/openclaw). It enables OpenClaw to send/receive messages through Feishu's enterprise messaging platform.

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
- `index.ts` - Plugin registration, exports public API

### Core Modules (src/)

**Connection & Events:**
- `client.ts` - Feishu SDK client factory (REST + WebSocket)
- `monitor.ts` - WebSocket event listener, dispatches incoming messages
- `bot.ts` - Message event handler, parses content, resolves media, dispatches to agent

**Outbound:**
- `send.ts` - Text messages, interactive cards, message editing
- `media.ts` - Upload/download images and files, inbound media resolution
- `outbound.ts` - `ChannelOutboundAdapter` implementation
- `reply-dispatcher.ts` - Streaming reply handling with render mode (raw/card/auto)

**Configuration & Policy:**
- `config-schema.ts` - Zod schemas for channel config
- `policy.ts` - DM/group allowlist, mention requirements
- `accounts.ts` - Credential resolution
- `types.ts` - TypeScript type definitions

**Utilities:**
- `targets.ts` - Normalize `user:xxx`/`chat:xxx` target formats
- `directory.ts` - User/group lookup
- `reactions.ts` - Emoji reactions API
- `typing.ts` - Typing indicator (emoji-based)
- `probe.ts` - Bot health check

### Message Flow

1. `monitor.ts` starts WebSocket connection, registers event handlers
2. On `im.message.receive_v1`, `bot.ts` parses the event
3. For media messages, `media.ts` downloads content via `im.messageResource.get`
4. Message is dispatched to OpenClaw agent via `reply-dispatcher.ts`
5. Agent responses flow through `outbound.ts` → `send.ts` (text/card based on `renderMode`)

### Key Configuration Options

| Option | Description |
|--------|-------------|
| `connectionMode` | `websocket` (default) or `webhook` |
| `dmPolicy` | `pairing` / `open` / `allowlist` |
| `groupPolicy` | `open` / `allowlist` / `disabled` |
| `requireMention` | Require @bot in groups (default: true) |
| `renderMode` | `auto` / `raw` / `card` for markdown rendering |

### Feishu SDK Usage

Uses `@larksuiteoapi/node-sdk`. Key APIs:
- `client.im.message.create/reply` - Send messages
- `client.im.messageResource.get` - Download media from messages
- `client.im.image.create` - Upload images
- `client.im.file.create` - Upload files
- `WSClient` - Long-polling WebSocket for events
