---
name: feishu-task
description: |
  Feishu Task attachments management. Activate when user mentions task attachments.
---

# Feishu Task Attachment Tools

Tools:
- `feishu_task_attachment_upload`
- `feishu_task_attachment_list`
- `feishu_task_attachment_get`
- `feishu_task_attachment_delete`

## Notes

- `task_guid` can be taken from a task URL (guid query param) or from `feishu_task_get` output.
- `attachment_guid` can be obtained from `feishu_task_attachment_list` output.
- Upload supports local `file_path` and OSS `file_url` (public/presigned).
- For `file_url`, the file is downloaded to `os.tmpdir()` before uploading.

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

## List Attachments

```json
{
  "task_guid": "e297ddff-06ca-4166-b917-4ce57cd3a7a0",
  "page_size": 50,
  "user_id_type": "open_id"
}
```

## Get Attachment

```json
{
  "attachment_guid": "a9f05f1c-4f86-4b0b-9c10-08cebe6a9c7a",
  "user_id_type": "open_id"
}
```

## Delete Attachment

```json
{
  "attachment_guid": "a9f05f1c-4f86-4b0b-9c10-08cebe6a9c7a"
}
```
