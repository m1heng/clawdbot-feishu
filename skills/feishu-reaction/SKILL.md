---
name: feishu-reaction
description: |
  Feishu message emoji reactions. Activate when user mentions emoji, reaction, thumbsup, like, or responding to messages with emoji.
---

# Feishu Reaction Tool

Single tool `feishu_reaction` for adding, removing, and listing emoji reactions on Feishu messages.

## Workflow: Reacting to Previous Messages

To react to a message other than the current one, first use `feishu_message` with `action: "list"` to fetch recent messages and find the target `message_id`, then use `feishu_reaction` with that `message_id`.

## Actions

### Add Reaction

```json
{
  "action": "add",
  "message_id": "om_xxx",
  "emoji_type": "THUMBSUP"
}
```

Returns:

```json
{
  "ok": true,
  "action": "add",
  "message_id": "om_xxx",
  "emoji_type": "THUMBSUP",
  "reaction_id": "ZCaCIjUBVVWSrm5L-3ZTw"
}
```

### Remove Reaction

```json
{
  "action": "remove",
  "message_id": "om_xxx",
  "reaction_id": "ZCaCIjUBVVWSrm5L-3ZTw"
}
```

### List Reactions

List all reactions on a message:

```json
{
  "action": "list",
  "message_id": "om_xxx"
}
```

Filter by emoji type:

```json
{
  "action": "list",
  "message_id": "om_xxx",
  "emoji_type": "THUMBSUP"
}
```

Returns:

```json
{
  "ok": true,
  "action": "list",
  "message_id": "om_xxx",
  "emoji_type_filter": "THUMBSUP",
  "total": 2,
  "reactions": [
    {
      "reaction_id": "ZCaCIjUBVVWSrm5L-3ZTw",
      "emoji_type": "THUMBSUP",
      "operator_type": "user",
      "operator_id": "ou_xxx"
    }
  ]
}
```

## Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `action` | Yes | `add`, `remove`, or `list` |
| `message_id` | Yes | Feishu message ID (e.g., `om_xxx`) |
| `emoji_type` | add: Yes, list: Optional | Emoji type (e.g., `THUMBSUP`, `HEART`, `SMILE`) |
| `reaction_id` | remove: Yes | Reaction ID from add or list results |

## Common Emoji Types

| Emoji | Type |
|-------|------|
| THUMBSUP | THUMBSDOWN | HEART | SMILE | GRINNING |
| FIRE | CLAP | OK | CHECK | CROSS |
| PARTY | PRAY | CRY | ANGRY | THINKING |
| SURPRISED | LAUGHING | FIST | QUESTION | EXCLAMATION |

## Configuration

```yaml
channels:
  feishu:
    tools:
      reaction: true  # default: true
```

## Permissions

- `im:message.reaction:write` - Add and remove reactions
- `im:message.reaction:read` - List reactions on messages
