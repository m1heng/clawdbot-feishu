---
name: feishu-task
description: |
  Feishu Task, subtask, comment, and attachment management. Activate when user mentions tasks, subtasks, task comments, task attachments, or task links.
---

# Feishu Task Tools

Tools:
- `feishu_task_create`
- `feishu_task_subtask_create`
- `feishu_task_get`
- `feishu_task_update`
- `feishu_task_delete`
- `feishu_task_comment_create`
- `feishu_task_comment_list`
- `feishu_task_comment_get`
- `feishu_task_comment_update`
- `feishu_task_comment_delete`
- `feishu_task_attachment_upload`
- `feishu_task_attachment_list`
- `feishu_task_attachment_get`
- `feishu_task_attachment_delete`

## Notes

- `task_guid` can be taken from a task URL (guid query param) or from `feishu_task_get` output.
- `comment_id` can be obtained from `feishu_task_comment_list` output.
- `attachment_guid` can be obtained from `feishu_task_attachment_list` output.
- `user_id_type` controls returned/accepted user identity type (`open_id`, `user_id`, `union_id`).
- If no assignee is specified, set the assignee to the requesting user. Avoid creating unassigned tasks because the user may not be able to view them.
- Task visibility: users can only view tasks when they are included as assignee.
- Current limitation: the bot can only create subtasks for tasks created by itself.
- Attachment upload supports local `file_path` and remote `file_url`. Remote URLs are fetched with runtime media safety checks and size limit (`mediaMaxMb`).

## Create Task

```json
{
  "summary": "Quarterly review",
  "description": "Prepare review notes",
  "due": { "timestamp": "1735689600000", "is_all_day": true },
  "members": [
    { "id": "ou_xxx", "role": "assignee", "type": "user" }
  ],
  "user_id_type": "open_id"
}
```

## Create Subtask

```json
{
  "task_guid": "e297ddff-06ca-4166-b917-4ce57cd3a7a0",
  "summary": "Draft report outline",
  "description": "Collect key metrics",
  "due": { "timestamp": "1735689600000", "is_all_day": true },
  "members": [
    { "id": "ou_xxx", "role": "assignee", "type": "user" }
  ],
  "user_id_type": "open_id"
}
```

## Create Comment

```json
{
  "task_guid": "e297ddff-06ca-4166-b917-4ce57cd3a7a0",
  "content": "Looks good to me",
  "user_id_type": "open_id"
}
```

## Upload Attachment (file_path)

```json
{
  "task_guid": "e297ddff-06ca-4166-b917-4ce57cd3a7a0",
  "file_path": "/path/to/report.pdf",
  "user_id_type": "open_id"
}
```

## Upload Attachment (file_url)

```json
{
  "task_guid": "e297ddff-06ca-4166-b917-4ce57cd3a7a0",
  "file_url": "https://oss-example.com/bucket/report.pdf",
  "filename": "report.pdf",
  "user_id_type": "open_id"
}
```
