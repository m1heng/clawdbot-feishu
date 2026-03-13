---
name: feishu-message
description: |
  Feishu message reading. Activate when user mentions reading messages, chat history, message lookup, or finding previous messages.
---

# Feishu Message Tool

Single tool `feishu_message` for reading Feishu messages — get a single message by ID or list recent messages in a chat.

## Actions

### Get Single Message

```json
{
  "action": "get",
  "message_id": "om_xxx"
}
```

Returns:

```json
{
  "ok": true,
  "action": "get",
  "found": true,
  "message_id": "om_xxx",
  "msg_type": "text",
  "content": "Hello world",
  "sender_id": "ou_xxx",
  "sender_type": "user",
  "chat_id": "oc_xxx",
  "create_time": "1710000000000",
  "update_time": "1710000000000",
  "mentions": []
}
```

### List Recent Messages

List recent messages in a chat (DM or group), newest first by default.
Omit `chat_id` to use the current conversation's chat:

```json
{
  "action": "list"
}
```

With custom page size, sort order, and time range:

```json
{
  "action": "list",
  "chat_id": "oc_xxx",
  "page_size": 20,
  "sort_type": "ByCreateTimeAsc",
  "start_time": "1710000000",
  "end_time": "1710086400"
}
```

Returns:

```json
{
  "ok": true,
  "action": "list",
  "chat_id": "oc_xxx",
  "total": 10,
  "messages": [
    {
      "message_id": "om_xxx",
      "msg_type": "text",
      "content_preview": "Hello world",
      "sender_id": "ou_xxx",
      "sender_type": "user",
      "create_time": "1710000000000",
      "chat_id": "oc_xxx"
    }
  ]
}
```

## Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `action` | Yes | `get` or `list` |
| `message_id` | get: Yes | Feishu message ID (e.g., `om_xxx`) |
| `chat_id` | list: Optional | Chat ID (e.g., `oc_xxx`). Omit to use current chat. |
| `page_size` | list: Optional | Number of messages (default: 10, max: 50) |
| `sort_type` | list: Optional | `ByCreateTimeDesc` (default) or `ByCreateTimeAsc` |
| `start_time` | list: Optional | Unix timestamp in seconds (e.g., `"1710000000"`). No lower bound if omitted. |
| `end_time` | list: Optional | Unix timestamp in seconds (e.g., `"1710086400"`). No upper bound if omitted. |

## Configuration

```yaml
channels:
  feishu:
    tools:
      message: true  # default: true
```

## Permissions

- `im:message:readonly` - Read messages
- For group messages, the app also needs **"获取群组中所有消息"** permission
