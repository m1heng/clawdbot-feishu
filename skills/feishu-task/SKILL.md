---
name: feishu-task
description: |
  Feishu Tasklist management. Activate when user mentions tasklists.
---

# Feishu Tasklist Tools

Tools:
- `feishu_task_add_tasklist`
- `feishu_task_remove_tasklist`
- `feishu_tasklist_create`
- `feishu_tasklist_get`
- `feishu_tasklist_list`
- `feishu_tasklist_update`
- `feishu_tasklist_delete`
- `feishu_tasklist_add_members`
- `feishu_tasklist_remove_members`

## Notes

- `task_guid` can be taken from a task URL (guid query param) or from `feishu_task_get` output.
- Keep tasklist owner as the bot. Add users as members to avoid losing bot access.
- Use `user_id_type` to control member ID formats.

## Tasklist Membership For Tasks

Use these tools to move tasks into or out of tasklists. Do not use `feishu_task_update` for tasklist changes.

### Add Task to Tasklist

```json
{
  "task_guid": "e297ddff-06ca-4166-b917-4ce57cd3a7a0",
  "tasklist_guid": "cc371766-6584-cf50-a222-c22cd9055004",
  "section_guid": "6d0f9f48-2e06-4e3d-8a0f-acde196e8c61",
  "user_id_type": "open_id"
}
```

### Remove Task from Tasklist

```json
{
  "task_guid": "e297ddff-06ca-4166-b917-4ce57cd3a7a0",
  "tasklist_guid": "cc371766-6584-cf50-a222-c22cd9055004",
  "user_id_type": "open_id"
}
```

## Tasklists

Tasklists support three roles: owner (read/edit/manage), editor (read/edit), viewer (read).

### Create Tasklist

```json
{
  "name": "Project Alpha Tasklist",
  "members": [
    { "id": "ou_xxx", "type": "user", "role": "editor" }
  ],
  "user_id_type": "open_id"
}
```

### Get Tasklist

```json
{
  "tasklist_guid": "cc371766-6584-cf50-a222-c22cd9055004",
  "user_id_type": "open_id"
}
```

### List Tasklists

```json
{
  "page_size": 50,
  "page_token": "aWQ9NzEwMjMzMjMxMDE=",
  "user_id_type": "open_id"
}
```

### Update Tasklist

```json
{
  "tasklist_guid": "cc371766-6584-cf50-a222-c22cd9055004",
  "tasklist": {
    "name": "Renamed Tasklist",
    "owner": { "id": "ou_xxx", "type": "user", "role": "owner" }
  },
  "update_fields": ["name", "owner"],
  "origin_owner_to_role": "editor",
  "user_id_type": "open_id"
}
```

### Delete Tasklist

```json
{
  "tasklist_guid": "cc371766-6584-cf50-a222-c22cd9055004"
}
```

### Add Tasklist Members

```json
{
  "tasklist_guid": "cc371766-6584-cf50-a222-c22cd9055004",
  "members": [
    { "id": "ou_xxx", "type": "user", "role": "editor" }
  ],
  "user_id_type": "open_id"
}
```

### Remove Tasklist Members

```json
{
  "tasklist_guid": "cc371766-6584-cf50-a222-c22cd9055004",
  "members": [
    { "id": "ou_xxx", "type": "user", "role": "viewer" }
  ],
  "user_id_type": "open_id"
}
```
