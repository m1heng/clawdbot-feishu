---
name: feishu-chat
description: |
  Feishu group chat manager. Activate when user asks to create groups, add users/bots to groups, check whether bot is in a group, or create a one-step session group.
---

# Feishu Group Chat Manager

You are an expert in Feishu group chat operations. Use `feishu_chat` for all group chat management requests.

## 1. Core Action Mapping

| User Intent | Tool Action | Notes |
| --- | --- | --- |
| Create a group | `group_chat_create` | Supports `user_id_list` and `bot_id_list` during creation |
| Add users/bots to existing group | `group_chat_add_members` | Use `member_id_type="app_id"` when adding bots |
| Check whether current bot is in a group | `group_chat_is_in_chat` | Returns `is_in_chat` boolean |
| One-step session group creation | `group_chat_create_session` | Creates group, invites participant, and sends greeting automatically |

## 2. Execution Strategy

- Prefer `group_chat_create_session` when user asks for a "new discussion/session group".
- If user asks to add members to an existing group, require `chat_id` first.
- For bots, set `member_id_type` to `app_id`; for users, use `open_id` unless user explicitly provides another id type.
- When `group_chat_add_members` returns `invalid_id_list`, `not_existed_id_list`, or `pending_approval_id_list`, explain clearly instead of saying generic failure.
- If permissions are insufficient (for example non-admin invite restrictions), return a clear action-oriented message to the user.

## 3. Default Session Group Convention

When user does not specify details for one-step session group:

- `name`: use a concise topic-based name (for example `问题排查-会话群`)
- `participant_id_type`: default to `open_id`
- `greeting`: use a short kickoff message, for example `你好，我们在这个群继续聊。`

## 4. Examples

### Create group

```json
{
  "action": "group_chat_create",
  "name": "项目周会",
  "user_id_list": ["ou_xxx"],
  "bot_id_list": ["cli_xxx"]
}
```

### One-step session group (recommended)

```json
{
  "action": "group_chat_create_session",
  "name": "问题排查-会话群",
  "participant_id": "ou_xxx",
  "participant_id_type": "open_id",
  "greeting": "你好，我们在这个群继续聊。"
}
```

### Add members to existing group

```json
{
  "action": "group_chat_add_members",
  "chat_id": "oc_xxx",
  "member_id_type": "open_id",
  "id_list": ["ou_xxx"]
}
```

### Add bot to existing group

```json
{
  "action": "group_chat_add_members",
  "chat_id": "oc_xxx",
  "member_id_type": "app_id",
  "id_list": ["cli_xxx"]
}
```

### Check bot membership

```json
{
  "action": "group_chat_is_in_chat",
  "chat_id": "oc_xxx"
}
```

## 5. Configuration

```yaml
channels:
  feishu:
    tools:
      chat: true  # default: true
```

## 6. Permissions

Required:
- `im:chat` - Create groups and add members
- `im:chat:readonly` - Check whether current bot is in group
- `im:message:send_as_bot` - Send greeting in `group_chat_create_session`

## 7. Guardrails

- Keep action names unchanged: `group_chat_create`, `group_chat_create_session`, `group_chat_add_members`, `group_chat_is_in_chat`.
- Do not invent actions like `create_chat` or `check_bot_in_chat`.
- Do not change group mention response rules; this skill only orchestrates tool calls.
