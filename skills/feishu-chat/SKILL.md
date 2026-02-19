---
name: feishu-chat
description: |
  Feishu chat operations including group announcement reading and writing. Activate when user mentions Feishu group announcements, chat management, or group settings.
---

# Feishu Chat Tool

Single tool `feishu_chat` with action parameter for group chat operations including announcement management.

## Chat ID

Chat ID can be obtained from group URLs or via the Feishu UI.

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

Returns complete announcement content. Supports both old (doc) and new (docx) announcement formats:
- **doc**: Legacy format using `im.chatAnnouncement` API
- **docx**: New format using `docx.chatAnnouncement` and `docx.chatAnnouncementBlock` APIs

### List Announcement Blocks

```json
{ "action": "list_announcement_blocks", "chat_id": "oc_abc123def" }
```

Returns all blocks for a docx-format announcement. Use this to get the complete structured content.

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

Appends content to the announcement:
- For `doc` format: Appends to the existing content
- For `docx` format: Creates a new text block as a child of the root block

### Update Announcement Block

```json
{ "action": "update_announcement_block", "chat_id": "oc_abc123def", "block_id": "block_123", "content": "New text content" }
```

Updates a single block's text content in a docx-format announcement. Uses batchUpdate API with revision_id for concurrency control.

### Delete Announcement Block

```json
{ "action": "delete_announcement_block", "chat_id": "oc_abc123def", "block_id": "block_123" }
```

**Note**: Deletion requires knowing the parent block ID and child indices. Use `list_announcement_blocks` to view the structure first.

## Announcement Types

The tool automatically detects and handles both announcement formats:

| Type | Description |
|------|-------------|
| `doc` | Legacy document-based announcement |
| `docx` | New docx-based announcement with block structure |

For `docx` type, the response includes both `info` (metadata) and `blocks` (content blocks).

## Configuration

```yaml
channels:
  feishu:
    tools:
      chat: true  # default: true
```

## Permissions

Required:
- `im:chat.announcement:read` - View group announcement information
- `im:chat.announcement` - Edit group announcement information (for write operations)
- `im:chat:readonly` or `im:chat` - Get group information (optional but recommended)

## Events

The plugin also listens for `im.chat.updated_v1` events which fire when any chat configuration changes (including announcement updates). Currently this is only logged for debugging purposes.
