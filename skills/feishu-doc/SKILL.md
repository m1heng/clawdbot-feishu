---
name: feishu-doc
description: |
  Feishu document read/write operations + comment management. Activate when user mentions Feishu docs, cloud docs, docx links, or document comments.
---

# Feishu Document Tool

Single tool `feishu_doc` with action parameter for all document operations including comment management.

## Token Extraction

From URL `https://xxx.feishu.cn/docx/ABC123def` → `doc_token` = `ABC123def`

## Actions

### Read Document

```json
{ "action": "read", "doc_token": "ABC123def" }
```

Returns: title, plain text content, block statistics. Check `hint` field - if present, structured content (tables, images) exists that requires `list_blocks`.

### Write Document (Replace All)

```json
{ "action": "write", "doc_token": "ABC123def", "content": "# Title\n\nMarkdown content..." }
```

Replaces entire document with markdown content. Supports: headings, lists, code blocks, quotes, links, images (`![](url)` auto-uploaded), bold/italic/strikethrough.

**Limitation:** Markdown tables are NOT supported.

### Create + Write (Atomic, Recommended)

```json
{
  "action": "create_and_write",
  "title": "New Document",
  "content": "# Title\n\nMarkdown content..."
}
```

With folder:
```json
{
  "action": "create_and_write",
  "title": "New Document",
  "content": "# Title\n\nMarkdown content...",
  "folder_token": "fldcnXXX"
}
```

Creates the document and writes content in one call. Prefer this over separate `create` + `write`.

### Append Content

```json
{ "action": "append", "doc_token": "ABC123def", "content": "Additional content" }
```

Appends markdown to end of document.

### Create Document

```json
{ "action": "create", "title": "New Document" }
```

With folder:
```json
{ "action": "create", "title": "New Document", "folder_token": "fldcnXXX" }
```

Creates an empty document (title only).

### List Blocks

```json
{ "action": "list_blocks", "doc_token": "ABC123def" }
```

Returns full block data including tables, images. Use this to read structured content.

### Get Single Block

```json
{ "action": "get_block", "doc_token": "ABC123def", "block_id": "doxcnXXX" }
```

### Update Block Text

```json
{ "action": "update_block", "doc_token": "ABC123def", "block_id": "doxcnXXX", "content": "New text" }
```

### Delete Block

```json
{ "action": "delete_block", "doc_token": "ABC123def", "block_id": "doxcnXXX" }
```

### List Comments

```json
{ "action": "list_comments", "doc_token": "ABC123def", "page_size": 50 }
```

Returns all comments for the document. Use `page_token` for pagination. Comments include `is_whole` field to distinguish between whole-document comments (true) and block-level comments (false).

### Get Single Comment

```json
{ "action": "get_comment", "doc_token": "ABC123def", "comment_id": "comment_xxx" }
```

### Create Comment

```json
{ "action": "create_comment", "doc_token": "ABC123def", "content": "Comment text" }
```

### List Comment Replies

```json
{ "action": "list_comment_replies", "doc_token": "ABC123def", "comment_id": "comment_xxx", "page_size": 50 }
```

`page_size` should be a positive integer. If omitted, tool defaults to `50`.

### Comment Write Scope

Current tool provides documented comment write action `create_comment` (global comment creation).
For replies, use `list_comment_replies` for retrieval; the reply creation endpoint is not exposed in current SDK surface.

## Reading Workflow

1. Start with `action: "read"` - get plain text + statistics
2. Check `block_types` in response for Table, Image, Code, etc.
3. If structured content exists, use `action: "list_blocks"` for full data

## Configuration

```yaml
channels:
  feishu:
    tools:
      doc: true  # default: true
```

**Note:** `feishu_wiki` depends on this tool - wiki page content is read/written via `feishu_doc`.

## Permissions

Required: `docx:document`, `docx:document:readonly`, `docx:document.block:convert`, `drive:drive`

For comment operations:
- Read comments: `docx:document.comment:read`
- Write comments: `docx:document.comment` (optional, for create_comment)
