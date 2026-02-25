# Feishu Chat Tool

Feishu chat operations including group announcement reading/writing and group chat management.

## Actions

### Get Announcement Info

```json
{ "action": "get_announcement_info", "chat_id": "oc_abc123def" }
```

Returns basic announcement information including type (doc or docx) and metadata.

### Get Full Announcement

```json
{ "action": "get_announcement", "chat_id": "oc_abc123def" }
```

Returns complete announcement content. Supports both old (doc) and new (docx) announcement formats.

### List Announcement Blocks

```json
{ "action": "list_announcement_blocks", "chat_id": "oc_abc123def" }
```

Returns all blocks for a docx-format announcement.

### Get Single Announcement Block

```json
{ "action": "get_announcement_block", "chat_id": "oc_abc123def", "block_id": "block_123" }
```

Returns a single block from the announcement.

### Write Announcement (doc format only)

```json
{ "action": "write_announcement", "chat_id": "oc_abc123def", "content": "New announcement content" }
```

Replaces the entire announcement content. Only supported for legacy `doc` format announcements.

### Append Announcement

```json
{ "action": "append_announcement", "chat_id": "oc_abc123def", "content": "Additional content" }
```

Appends content to the announcement.

### Update Announcement Block

```json
{ "action": "update_announcement_block", "chat_id": "oc_abc123def", "block_id": "block_123", "content": "New text content" }
```

Updates a single block's text content in a docx-format announcement.

### Delete Announcement Block

```json
{ "action": "delete_announcement_block", "chat_id": "oc_abc123def", "block_id": "block_123" }
```

**Note**: Deletion requires knowing the parent block ID and child indices. Use `list_announcement_blocks` to view the structure first.

---

## Group Chat Management

### Create Group Chat

```json
{ "action": "create_chat", "name": "My Group", "user_ids": ["ou_123", "ou_456"], "description": "Group description" }
```

Creates a new group chat with optional initial members and description.

### Add Members to Group

```json
{ "action": "add_members", "chat_id": "oc_abc123def", "user_ids": ["ou_123", "ou_456"] }
```

Adds specified users to an existing group chat.

### Check Bot in Chat

```json
{ "action": "check_bot_in_chat", "chat_id": "oc_abc123def" }
```

Checks if the bot is a member of the specified chat.

### Delete Chat

```json
{ "action": "delete_chat", "chat_id": "oc_abc123def" }
```

Deletes/disbands a group chat. The bot must have appropriate permissions (typically needs to be the group owner or have admin privileges).

**Note**: Deleting a chat will remove all members and the chat history will no longer be accessible. Use with caution.

### Create Session Chat (One-Step)

```json
{ 
  "action": "create_session_chat", 
  "name": "Project Discussion", 
  "user_ids": ["ou_123", "ou_456"],
  "greeting": "Hi everyone! Let's discuss the project here.",
  "description": "Group for project collaboration"
}
```

One-step operation that creates a group chat, adds users, and sends a greeting message.

---

## Configuration

```yaml
channels:
  feishu:
    tools:
      chat: true  # default: true
```

## Permissions

Required for announcements:
- `im:chat.announcement:read` - View group announcement information
- `im:chat.announcement` - Edit group announcement information (for write operations)

Additional permissions for group management:
- `im:chat` - Create and manage group chats
- `im:message:send_as_bot` - Send messages as bot (for create_session_chat greeting)

**Note for delete_chat**: Requires the bot to be the group owner or have admin privileges to disband the chat.
