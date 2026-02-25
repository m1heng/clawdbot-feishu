---
name: feishu-task
description: |
  Feishu Task and Task Comment management. Activate when user mentions tasks, subtasks, task comments, or task links.
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

## Notes

- `task_guid` can be taken from a task URL (guid query param) or from `feishu_task_get` output.
- `comment_id` can be obtained from `feishu_task_comment_list` output.
- `user_id_type` controls returned/accepted user identity type (`open_id`, `user_id`, `union_id`).
- If no assignee is specified, set the assignee to the requesting user. Avoid creating unassigned tasks because the user may not be able to view them.
- Task visibility: users can only view tasks when they are included as assignee.
- Current limitation: the bot can only create subtasks for tasks created by itself.

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

## Get Task

```json
{
  "task_guid": "e297ddff-06ca-4166-b917-4ce57cd3a7a0",
  "user_id_type": "open_id"
}
```

## Update Task

If `update_fields` is omitted, the tool infers it from keys in `task`.

```json
{
  "task_guid": "e297ddff-06ca-4166-b917-4ce57cd3a7a0",
  "task": {
    "summary": "Updated title",
    "description": "Updated description"
  },
  "update_fields": ["summary", "description"],
  "user_id_type": "open_id"
}
```

## Delete Task

```json
{
  "task_guid": "e297ddff-06ca-4166-b917-4ce57cd3a7a0"
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
