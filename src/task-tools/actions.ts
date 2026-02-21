import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { TaskClient } from "./common.js";
import type {
  CreateTaskCommentParams,
  DeleteTaskAttachmentParams,
  DeleteTaskCommentParams,
  GetTaskAttachmentParams,
  GetTaskCommentParams,
  ListTaskAttachmentsParams,
  ListTaskCommentsParams,
  TaskCommentPatchComment,
  UpdateTaskCommentParams,
  UploadTaskAttachmentParams,
  AddTaskToTasklistParams,
  AddTasklistMembersParams,
  CreateSubtaskParams,
  CreateTaskParams,
  CreateTasklistParams,
  GetTasklistParams,
  GetTaskParams,
  ListTasklistsParams,
  RemoveTaskFromTasklistParams,
  RemoveTasklistMembersParams,
  TaskUpdateTask,
  TasklistPatchTasklist,
  UpdateTasklistParams,
  UpdateTaskParams,
} from "./schemas.js";
import { runTaskApiCall } from "./common.js";

const SUPPORTED_PATCH_FIELDS = new Set<keyof TaskUpdateTask>([
  "summary",
  "description",
  "due",
  "start",
  "extra",
  "completed_at",
  "repeat_rule",
  "mode",
  "is_milestone",
]);
const SUPPORTED_TASKLIST_PATCH_FIELDS = new Set<keyof TasklistPatchTasklist>([
  "name",
  "owner",
  "archive_tasklist",
]);
const SUPPORTED_COMMENT_PATCH_FIELDS = new Set<keyof TaskCommentPatchComment>(["content"]);

function omitUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined),
  ) as T;
}

function inferUpdateFields(task: TaskUpdateTask): string[] {
  return Object.keys(task).filter((field) =>
    SUPPORTED_PATCH_FIELDS.has(field as keyof TaskUpdateTask),
  );
}

function ensureSupportedUpdateFields(updateFields: string[], supported: Set<string>) {
  const invalid = updateFields.filter((field) => !supported.has(field));
  if (invalid.length > 0) {
    throw new Error(
      `unsupported update_fields: ${invalid.join(
        ", ",
      )}. Use tasklist add/remove tools to move tasks between tasklists.`,
    );
  }
}

function inferTasklistUpdateFields(tasklist: TasklistPatchTasklist): string[] {
  return Object.keys(tasklist).filter((field) =>
    SUPPORTED_TASKLIST_PATCH_FIELDS.has(field as keyof TasklistPatchTasklist),
  );
}

function inferCommentUpdateFields(comment: TaskCommentPatchComment): string[] {
  return Object.keys(comment).filter((field) =>
    SUPPORTED_COMMENT_PATCH_FIELDS.has(field as keyof TaskCommentPatchComment),
  );
}

function formatTask(task: Record<string, unknown> | undefined) {
  if (!task) return undefined;
  return {
    guid: task.guid,
    task_id: task.task_id,
    summary: task.summary,
    description: task.description,
    status: task.status,
    url: task.url,
    created_at: task.created_at,
    updated_at: task.updated_at,
    completed_at: task.completed_at,
    due: task.due,
    start: task.start,
    is_milestone: task.is_milestone,
    members: task.members,
    tasklists: task.tasklists,
  };
}

function formatComment(comment: Record<string, unknown> | undefined) {
  if (!comment) return undefined;
  return {
    id: comment.id,
    content: comment.content,
    creator: comment.creator,
    reply_to_comment_id: comment.reply_to_comment_id,
    created_at: comment.created_at,
    updated_at: comment.updated_at,
    resource_type: comment.resource_type,
    resource_id: comment.resource_id,
  };
}

function formatAttachment(attachment: Record<string, unknown> | undefined) {
  if (!attachment) return undefined;
  return {
    guid: attachment.guid,
    file_token: attachment.file_token,
    name: attachment.name,
    size: attachment.size,
    uploader: attachment.uploader,
    is_cover: attachment.is_cover,
    uploaded_at: attachment.uploaded_at,
    url: attachment.url,
    resource: attachment.resource,
  };
}

function formatTasklist(tasklist: Record<string, unknown> | undefined) {
  if (!tasklist) return undefined;
  return {
    guid: tasklist.guid,
    name: tasklist.name,
    creator: tasklist.creator,
    owner: tasklist.owner,
    members: tasklist.members,
    url: tasklist.url,
    created_at: tasklist.created_at,
    updated_at: tasklist.updated_at,
    archive_msec: tasklist.archive_msec,
  };
}

async function downloadToTempFile(fileUrl: string, filename?: string) {
  const url = new URL(fileUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`unsupported file_url protocol: ${url.protocol}`);
  }

  const inferredName = path.basename(url.pathname) || filename || "attachment";
  const tempPath = path.join(
    os.tmpdir(),
    `feishu-task-attachment-${Date.now()}-${Math.random().toString(16).slice(2)}-${inferredName}`,
  );

  const res = await fetch(fileUrl);
  if (!res.ok || !res.body) {
    throw new Error(`failed to download file_url: ${res.status} ${res.statusText}`);
  }

  const readable = Readable.fromWeb(res.body as unknown as WebReadableStream);
  const writeStream = fs.createWriteStream(tempPath);
  await pipeline(readable, writeStream);

  return {
    tempPath,
    cleanup: async () => {
      await fs.promises.unlink(tempPath).catch(() => undefined);
    },
  };
}

export async function createTask(client: TaskClient, params: CreateTaskParams) {
  const res = await runTaskApiCall("task.v2.task.create", () =>
    client.task.v2.task.create({
      data: omitUndefined({
        summary: params.summary,
        description: params.description,
        due: params.due,
        start: params.start,
        extra: params.extra,
        completed_at: params.completed_at,
        members: params.members,
        repeat_rule: params.repeat_rule,
        tasklists: params.tasklists,
        mode: params.mode,
        is_milestone: params.is_milestone,
      }),
      params: omitUndefined({
        user_id_type: params.user_id_type,
      }),
    }),
  );

  return {
    task: formatTask((res.data?.task ?? undefined) as Record<string, unknown> | undefined),
  };
}

export async function createTaskComment(client: TaskClient, params: CreateTaskCommentParams) {
  const res = await runTaskApiCall("task.v2.comment.create", () =>
    client.task.v2.comment.create({
      data: {
        content: params.content,
        reply_to_comment_id: params.reply_to_comment_id,
        resource_type: "task",
        resource_id: params.task_guid,
      },
      params: omitUndefined({
        user_id_type: params.user_id_type,
      }),
    }),
  );

  return {
    comment: formatComment(
      (res.data?.comment ?? undefined) as Record<string, unknown> | undefined,
    ),
  };
}

export async function createTasklist(client: TaskClient, params: CreateTasklistParams) {
  const res = await runTaskApiCall("task.v2.tasklist.create", () =>
    client.task.v2.tasklist.create({
      data: omitUndefined({
        name: params.name,
        members: params.members,
        archive_tasklist: params.archive_tasklist,
      }),
      params: omitUndefined({
        user_id_type: params.user_id_type,
      }),
    }),
  );

  return {
    tasklist: formatTasklist(
      (res.data?.tasklist ?? undefined) as Record<string, unknown> | undefined,
    ),
  };
}

export async function createSubtask(client: TaskClient, params: CreateSubtaskParams) {
  const res = await runTaskApiCall("task.v2.taskSubtask.create", () =>
    client.task.v2.taskSubtask.create({
      path: { task_guid: params.task_guid },
      data: omitUndefined({
        summary: params.summary,
        description: params.description,
        due: params.due,
        start: params.start,
        extra: params.extra,
        completed_at: params.completed_at,
        members: params.members,
        repeat_rule: params.repeat_rule,
        tasklists: params.tasklists,
        mode: params.mode,
        is_milestone: params.is_milestone,
      }),
      params: omitUndefined({
        user_id_type: params.user_id_type,
      }),
    }),
  );

  return {
    subtask: formatTask((res.data?.subtask ?? undefined) as Record<string, unknown> | undefined),
  };
}

export async function deleteTaskAttachment(client: TaskClient, params: DeleteTaskAttachmentParams) {
  await runTaskApiCall("task.v2.attachment.delete", () =>
    client.task.v2.attachment.delete({
      path: { attachment_guid: params.attachment_guid },
    }),
  );

  return {
    success: true,
    attachment_guid: params.attachment_guid,
  };
}

export async function deleteTaskComment(client: TaskClient, params: DeleteTaskCommentParams) {
  await runTaskApiCall("task.v2.comment.delete", () =>
    client.task.v2.comment.delete({
      path: { comment_id: params.comment_id },
    }),
  );

  return {
    success: true,
    comment_id: params.comment_id,
  };
}

export async function deleteTask(client: TaskClient, taskGuid: string) {
  await runTaskApiCall("task.v2.task.delete", () =>
    client.task.v2.task.delete({
      path: { task_guid: taskGuid },
    }),
  );

  return {
    success: true,
    task_guid: taskGuid,
  };
}

export async function deleteTasklist(client: TaskClient, tasklistGuid: string) {
  await runTaskApiCall("task.v2.tasklist.delete", () =>
    client.task.v2.tasklist.delete({
      path: { tasklist_guid: tasklistGuid },
    }),
  );

  return {
    success: true,
    tasklist_guid: tasklistGuid,
  };
}

export async function getTask(client: TaskClient, params: GetTaskParams) {
  const res = await runTaskApiCall("task.v2.task.get", () =>
    client.task.v2.task.get({
      path: { task_guid: params.task_guid },
      params: omitUndefined({
        user_id_type: params.user_id_type,
      }),
    }),
  );

  return {
    task: formatTask((res.data?.task ?? undefined) as Record<string, unknown> | undefined),
  };
}

export async function getTaskAttachment(client: TaskClient, params: GetTaskAttachmentParams) {
  const res = await runTaskApiCall("task.v2.attachment.get", () =>
    client.task.v2.attachment.get({
      path: { attachment_guid: params.attachment_guid },
      params: omitUndefined({
        user_id_type: params.user_id_type,
      }),
    }),
  );

  return {
    attachment: formatAttachment(
      (res.data?.attachment ?? undefined) as Record<string, unknown> | undefined,
    ),
  };
}

export async function getTaskComment(client: TaskClient, params: GetTaskCommentParams) {
  const res = await runTaskApiCall("task.v2.comment.get", () =>
    client.task.v2.comment.get({
      path: { comment_id: params.comment_id },
      params: omitUndefined({
        user_id_type: params.user_id_type,
      }),
    }),
  );

  return {
    comment: formatComment(
      (res.data?.comment ?? undefined) as Record<string, unknown> | undefined,
    ),
  };
}

export async function getTasklist(client: TaskClient, params: GetTasklistParams) {
  const res = await runTaskApiCall("task.v2.tasklist.get", () =>
    client.task.v2.tasklist.get({
      path: { tasklist_guid: params.tasklist_guid },
      params: omitUndefined({
        user_id_type: params.user_id_type,
      }),
    }),
  );

  return {
    tasklist: formatTasklist(
      (res.data?.tasklist ?? undefined) as Record<string, unknown> | undefined,
    ),
  };
}

export async function listTaskAttachments(client: TaskClient, params: ListTaskAttachmentsParams) {
  const res = await runTaskApiCall("task.v2.attachment.list", () =>
    client.task.v2.attachment.list({
      params: omitUndefined({
        resource_type: "task",
        resource_id: params.task_guid,
        page_size: params.page_size,
        page_token: params.page_token,
        updated_mesc: params.updated_mesc,
        user_id_type: params.user_id_type,
      }),
    }),
  );

  const items = (res.data?.items ?? []) as Record<string, unknown>[];

  return {
    items: items.map((item) => formatAttachment(item)),
    page_token: res.data?.page_token,
    has_more: res.data?.has_more,
  };
}

export async function listTaskComments(client: TaskClient, params: ListTaskCommentsParams) {
  const res = await runTaskApiCall("task.v2.comment.list", () =>
    client.task.v2.comment.list({
      params: omitUndefined({
        resource_type: "task",
        resource_id: params.task_guid,
        page_size: params.page_size,
        page_token: params.page_token,
        direction: params.direction,
        user_id_type: params.user_id_type,
      }),
    }),
  );

  const items = (res.data?.items ?? []) as Record<string, unknown>[];

  return {
    items: items.map((item) => formatComment(item)),
    page_token: res.data?.page_token,
    has_more: res.data?.has_more,
  };
}

export async function listTasklists(client: TaskClient, params: ListTasklistsParams) {
  const res = await runTaskApiCall("task.v2.tasklist.list", () =>
    client.task.v2.tasklist.list({
      params: omitUndefined({
        page_size: params.page_size,
        page_token: params.page_token,
        user_id_type: params.user_id_type,
      }),
    }),
  );

  const items = (res.data?.items ?? []) as Record<string, unknown>[];

  return {
    items: items.map((item) => formatTasklist(item)),
    page_token: res.data?.page_token,
    has_more: res.data?.has_more,
  };
}

export async function updateTask(client: TaskClient, params: UpdateTaskParams) {
  const task = omitUndefined(params.task as Record<string, unknown>) as TaskUpdateTask;
  const updateFields = params.update_fields?.length ? params.update_fields : inferUpdateFields(task);

  if (Object.keys(task).length === 0) {
    throw new Error("task update payload is empty");
  }
  if (updateFields.length === 0) {
    throw new Error("no valid update_fields provided or inferred from task payload");
  }
  if (params.update_fields?.length) {
    ensureSupportedUpdateFields(updateFields, SUPPORTED_PATCH_FIELDS as Set<string>);
  }

  const res = await runTaskApiCall("task.v2.task.patch", () =>
    client.task.v2.task.patch({
      path: { task_guid: params.task_guid },
      data: {
        task,
        update_fields: updateFields,
      },
      params: omitUndefined({
        user_id_type: params.user_id_type,
      }),
    }),
  );

  return {
    task: formatTask((res.data?.task ?? undefined) as Record<string, unknown> | undefined),
    update_fields: updateFields,
  };
}

export async function updateTaskComment(client: TaskClient, params: UpdateTaskCommentParams) {
  const comment = omitUndefined(params.comment as Record<string, unknown>) as TaskCommentPatchComment;
  const updateFields = params.update_fields?.length
    ? params.update_fields
    : inferCommentUpdateFields(comment);

  if (Object.keys(comment).length === 0) {
    throw new Error("comment update payload is empty");
  }
  if (updateFields.length === 0) {
    throw new Error("no valid update_fields provided or inferred from comment payload");
  }

  const invalid = updateFields.filter(
    (field) => !SUPPORTED_COMMENT_PATCH_FIELDS.has(field as keyof TaskCommentPatchComment),
  );
  if (invalid.length > 0) {
    throw new Error(`unsupported update_fields: ${invalid.join(", ")}`);
  }

  const res = await runTaskApiCall("task.v2.comment.patch", () =>
    client.task.v2.comment.patch({
      path: { comment_id: params.comment_id },
      data: {
        comment,
        update_fields: updateFields,
      },
      params: omitUndefined({
        user_id_type: params.user_id_type,
      }),
    }),
  );

  return {
    comment: formatComment(
      (res.data?.comment ?? undefined) as Record<string, unknown> | undefined,
    ),
    update_fields: updateFields,
  };
}

export async function addTaskToTasklist(client: TaskClient, params: AddTaskToTasklistParams) {
  const res = await runTaskApiCall("task.v2.task.add_tasklist", () =>
    client.task.v2.task.addTasklist({
      path: { task_guid: params.task_guid },
      data: omitUndefined({
        tasklist_guid: params.tasklist_guid,
        section_guid: params.section_guid,
      }),
      params: omitUndefined({
        user_id_type: params.user_id_type,
      }),
    }),
  );

  return {
    task: formatTask((res.data?.task ?? undefined) as Record<string, unknown> | undefined),
  };
}

export async function removeTaskFromTasklist(
  client: TaskClient,
  params: RemoveTaskFromTasklistParams,
) {
  const res = await runTaskApiCall("task.v2.task.remove_tasklist", () =>
    client.task.v2.task.removeTasklist({
      path: { task_guid: params.task_guid },
      data: {
        tasklist_guid: params.tasklist_guid,
      },
      params: omitUndefined({
        user_id_type: params.user_id_type,
      }),
    }),
  );

  return {
    task: formatTask((res.data?.task ?? undefined) as Record<string, unknown> | undefined),
  };
}

export async function updateTasklist(client: TaskClient, params: UpdateTasklistParams) {
  const tasklist = omitUndefined(params.tasklist as Record<string, unknown>) as TasklistPatchTasklist;
  const updateFields = params.update_fields?.length
    ? params.update_fields
    : inferTasklistUpdateFields(tasklist);

  if (Object.keys(tasklist).length === 0) {
    throw new Error("tasklist update payload is empty");
  }
  if (updateFields.length === 0) {
    throw new Error("no valid update_fields provided or inferred from tasklist payload");
  }

  const res = await runTaskApiCall("task.v2.tasklist.patch", () =>
    client.task.v2.tasklist.patch({
      path: { tasklist_guid: params.tasklist_guid },
      data: omitUndefined({
        tasklist,
        update_fields: updateFields,
        origin_owner_to_role: params.origin_owner_to_role,
      }),
      params: omitUndefined({
        user_id_type: params.user_id_type,
      }),
    }),
  );

  return {
    tasklist: formatTasklist(
      (res.data?.tasklist ?? undefined) as Record<string, unknown> | undefined,
    ),
    update_fields: updateFields,
  };
}

export async function uploadTaskAttachment(client: TaskClient, params: UploadTaskAttachmentParams) {
  let tempCleanup: (() => Promise<void>) | undefined;
  let filePath: string | undefined;

  if ("file_path" in params) {
    filePath = params.file_path;
  } else {
    const download = await downloadToTempFile(params.file_url, params.filename);
    filePath = download.tempPath;
    tempCleanup = download.cleanup;
  }

  try {
    const res = await runTaskApiCall("task.v2.attachment.upload", async () => {
      const data = await client.task.v2.attachment.upload({
        data: {
          resource_type: "task",
          resource_id: params.task_guid,
          file: fs.createReadStream(filePath),
        },
        params: omitUndefined({
          user_id_type: params.user_id_type,
        }),
      });
      return { code: 0, data } as { code: number; data: typeof data };
    });

    const items = (res.data?.items ?? []) as Record<string, unknown>[];

    return {
      items: items.map((item) => formatAttachment(item)),
    };
  } finally {
    if (tempCleanup) {
      await tempCleanup();
    }
  }
}

export async function addTasklistMembers(client: TaskClient, params: AddTasklistMembersParams) {
  const res = await runTaskApiCall("task.v2.tasklist.addMembers", () =>
    client.task.v2.tasklist.addMembers({
      path: { tasklist_guid: params.tasklist_guid },
      data: {
        members: params.members,
      },
      params: omitUndefined({
        user_id_type: params.user_id_type,
      }),
    }),
  );

  return {
    tasklist: formatTasklist(
      (res.data?.tasklist ?? undefined) as Record<string, unknown> | undefined,
    ),
  };
}

export async function removeTasklistMembers(
  client: TaskClient,
  params: RemoveTasklistMembersParams,
) {
  const res = await runTaskApiCall("task.v2.tasklist.removeMembers", () =>
    client.task.v2.tasklist.removeMembers({
      path: { tasklist_guid: params.tasklist_guid },
      data: {
        members: params.members,
      },
      params: omitUndefined({
        user_id_type: params.user_id_type,
      }),
    }),
  );

  return {
    tasklist: formatTasklist(
      (res.data?.tasklist ?? undefined) as Record<string, unknown> | undefined,
    ),
  };
}
