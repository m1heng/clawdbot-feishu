---
name: feishu-task
description: |
  Feishu Task management. Activate when user mentions tasks, subtasks, or task links.
---

# Feishu Task Tools

Tools:
- `feishu_task_create`
- `feishu_task_subtask_create`
- `feishu_task_get`
- `feishu_task_update`
- `feishu_task_delete`

## Notes

- `task_guid` can be taken from a task URL (guid query param) or from `feishu_task_get` output.
- `user_id_type` controls the member id type (e.g. `open_id`, `user_id`, `union_id`).
- Subtask creation uses the same payload fields as task creation plus `task_guid`.
- If no assignee is specified, set the assignee to the requesting user. Do not create unassigned tasks because the user may not be able to view them.
- Task visibility: users can only view tasks when they are included as assignee. The bot can currently only create subtasks for tasks created by itself; for more flexible subtask organization, use tasklists.

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
