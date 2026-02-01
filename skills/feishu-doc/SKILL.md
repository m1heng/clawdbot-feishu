---
name: feishu-doc
description: |
  Feishu document read/write tools. Activate when user mentions Feishu docs, cloud docs, or docx links.
---

# Feishu Document Tools

## Reading a Document (IMPORTANT)

**Always follow this flow:**

1. **Start with `feishu_doc_read`** - Get plain text + block statistics
2. **Check `block_types` in response** - If you see `Table`, `Image`, `Code`, etc. but content seems empty/incomplete:
3. **Use `feishu_doc_list_blocks`** - Get full structured content of all blocks
4. **Optional: `feishu_doc_get_block`** - Get single block detail if needed

```
feishu_doc_read → check block_types → feishu_doc_list_blocks (if needed)
```

**Why?** `doc_read` returns plain text only. Tables and other structured content require `list_blocks`.

## Token Extraction

From URL `https://xxx.feishu.cn/docx/ABC123def` → `doc_token` = `ABC123def`

## Tool Reference

### Reading

| Tool | Input | Returns |
|------|-------|---------|
| `feishu_doc_read` | `doc_token` | Plain text, title, block_count, block_types |
| `feishu_doc_list_blocks` | `doc_token` | Full block data (tables, images, etc.) |
| `feishu_doc_get_block` | `doc_token`, `block_id` | Single block detail |

### Writing

| Tool | Input | Effect |
|------|-------|--------|
| `feishu_doc_create` | `title`, `folder_token?` | Create empty doc |
| `feishu_doc_write` | `doc_token`, `content` (markdown) | Replace all content |
| `feishu_doc_append` | `doc_token`, `content` (markdown) | Append to end |

### Block Operations

| Tool | Input | Effect |
|------|-------|--------|
| `feishu_doc_update_block` | `doc_token`, `block_id`, `content` | Update block text |
| `feishu_doc_delete_block` | `doc_token`, `block_id` | Delete block |

**Note:** `block_id` comes from `list_blocks` response.

### Utilities

| Tool | Use |
|------|-----|
| `feishu_folder_list` | List folder contents |
| `feishu_app_scopes` | Check app permissions |

## Markdown Syntax

For `write` and `append`: headings, lists, code blocks, quotes, links, images (`![](url)` auto-uploaded), bold/italic/strikethrough

**Limitation:** Markdown tables (`| ... |`) are NOT supported for write/append due to Feishu API restrictions. Use lists or code blocks to represent tabular data instead.

## Permissions

Required: `docx:document`, `docx:document:readonly`, `docx:document.block:convert` (for write/append), `drive:drive` (for images)
