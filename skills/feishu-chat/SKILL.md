---
name: feishu-chat
description: |
  Feishu group chat management operations. Activate when user asks to create groups, add users/bots to groups, check whether bot is in a group, or create a one-step session group.
---

# Feishu Chat Tool

Single tool `feishu_chat` with action parameter for group chat operations.

## Actions

### Create Group Chat

```json
{
  "action": "group_chat_create",
  "name": "项目周会",
  "user_id_list": ["ou_xxx"],
  "bot_id_list": ["cli_xxx"]
}
```

### Create One-Step Session Group (recommended)

```json
{
  "action": "group_chat_create_session",
  "name": "问题排查-会话群",
  "participant_id": "ou_xxx",
  "participant_id_type": "open_id",
  "greeting": "你好，我们在这个群继续聊。"
}
```

Behavior:
- Creates a new group
- Invites the specified participant during creation
- Sends a greeting message in the new group automatically

### Add Members to Existing Group

```json
{
  "action": "group_chat_add_members",
  "chat_id": "oc_xxx",
  "member_id_type": "open_id",
  "id_list": ["ou_xxx"]
}
```

For adding bots, set `member_id_type` to `app_id` and pass bot app IDs in `id_list`.

### Check Bot Membership

```json
{
  "action": "group_chat_is_in_chat",
  "chat_id": "oc_xxx"
}
```

## Configuration

```yaml
channels:
  feishu:
    tools:
      chat: true  # default: true
```

## Permissions

Required:
- `im:chat` - Create groups and add members
- `im:chat:readonly` - Check whether current bot is in a group
- `im:message:send_as_bot` - Send greeting in `group_chat_create_session`
