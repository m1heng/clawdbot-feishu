import type { TaskClient } from "./common.js";
import type {
  CreateSubtaskParams,
  CreateTaskCommentParams,
  CreateTaskParams,
  DeleteTaskCommentParams,
  GetTaskCommentParams,
  GetTaskParams,
  ListTaskCommentsParams,
  TaskCommentPatchComment,
  TaskUpdateTask,
  UpdateTaskCommentParams,
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

export async function updateTask(client: TaskClient, params: UpdateTaskParams) {
  const task = omitUndefined(params.task as Record<string, unknown>) as TaskUpdateTask;
  const updateFields = params.update_fields?.length ? params.update_fields : inferUpdateFields(task);

  if (Object.keys(task).length === 0) {
    throw new Error("task update payload is empty");
  }
  if (updateFields.length === 0) {
    throw new Error("no valid update_fields provided or inferred from task payload");
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
