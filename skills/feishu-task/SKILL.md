---
name: feishu-task
description: |
  Feishu Task comments management. Activate when user mentions task comments.
---

# Feishu Task Comment Tools

Tools:
- `feishu_task_comment_create`
- `feishu_task_comment_list`
- `feishu_task_comment_get`
- `feishu_task_comment_update`
- `feishu_task_comment_delete`

## Notes

- `task_guid` can be taken from a task URL (guid query param) or from `feishu_task_get` output.
- `comment_id` can be obtained from `feishu_task_comment_list` output.
- `user_id_type` controls returned/accepted user identity type (`open_id`, `user_id`, `union_id`).

## Create Comment

```json
{
  "task_guid": "e297ddff-06ca-4166-b917-4ce57cd3a7a0",
  "content": "Looks good to me",
  "user_id_type": "open_id"
}
```

## List Comments

```json
{
  "task_guid": "e297ddff-06ca-4166-b917-4ce57cd3a7a0",
  "page_size": 50,
  "user_id_type": "open_id"
}
```

## Get Comment

```json
{
  "comment_id": "7088226436635389954",
  "user_id_type": "open_id"
}
```

## Update Comment

```json
{
  "comment_id": "7088226436635389954",
  "comment": {
    "content": "Updated comment content"
  },
  "update_fields": ["content"],
  "user_id_type": "open_id"
}
```

## Delete Comment

```json
{
  "comment_id": "7088226436635389954"
}
```
