import { Type } from "@sinclair/typebox";
import type { TaskClient } from "./common.js";

type TaskCreatePayload = NonNullable<Parameters<TaskClient["task"]["v2"]["task"]["create"]>[0]>;
type TaskUpdatePayload = NonNullable<Parameters<TaskClient["task"]["v2"]["task"]["patch"]>[0]>;
type TaskDeletePayload = NonNullable<Parameters<TaskClient["task"]["v2"]["task"]["delete"]>[0]>;
type TaskGetPayload = NonNullable<Parameters<TaskClient["task"]["v2"]["task"]["get"]>[0]>;
type TaskCommentCreatePayload = NonNullable<
  Parameters<TaskClient["task"]["v2"]["comment"]["create"]>[0]
>;
type TaskCommentGetPayload = NonNullable<Parameters<TaskClient["task"]["v2"]["comment"]["get"]>[0]>;
type TaskCommentListPayload = NonNullable<
  Parameters<TaskClient["task"]["v2"]["comment"]["list"]>[0]
>;
type TaskCommentPatchPayload = NonNullable<
  Parameters<TaskClient["task"]["v2"]["comment"]["patch"]>[0]
>;
type TaskCommentDeletePayload = NonNullable<
  Parameters<TaskClient["task"]["v2"]["comment"]["delete"]>[0]
>;
type TaskAttachmentUploadPayload = NonNullable<
  Parameters<TaskClient["task"]["v2"]["attachment"]["upload"]>[0]
>;
type TaskAttachmentGetPayload = NonNullable<
  Parameters<TaskClient["task"]["v2"]["attachment"]["get"]>[0]
>;
type TaskAttachmentListPayload = NonNullable<
  Parameters<TaskClient["task"]["v2"]["attachment"]["list"]>[0]
>;
type TaskAttachmentDeletePayload = NonNullable<
  Parameters<TaskClient["task"]["v2"]["attachment"]["delete"]>[0]
>;

export type TaskCreateData = TaskCreatePayload["data"];
export type TaskUpdateData = TaskUpdatePayload["data"];
export type TaskUpdateTask = NonNullable<TaskUpdateData["task"]>;
export type TaskCommentPatchData = TaskCommentPatchPayload["data"];
export type TaskCommentPatchComment = TaskCommentPatchData["comment"];

export type CreateTaskParams = {
  summary: TaskCreateData["summary"];
  description?: TaskCreateData["description"];
  due?: TaskCreateData["due"];
  start?: TaskCreateData["start"];
  extra?: TaskCreateData["extra"];
  completed_at?: TaskCreateData["completed_at"];
  members?: TaskCreateData["members"];
  repeat_rule?: TaskCreateData["repeat_rule"];
  tasklists?: TaskCreateData["tasklists"];
  mode?: TaskCreateData["mode"];
  is_milestone?: TaskCreateData["is_milestone"];
  user_id_type?: NonNullable<TaskCreatePayload["params"]>["user_id_type"];
};

export type CreateSubtaskParams = CreateTaskParams & {
  task_guid: string;
};

export type DeleteTaskParams = {
  task_guid: TaskDeletePayload["path"]["task_guid"];
};

export type GetTaskParams = {
  task_guid: TaskGetPayload["path"]["task_guid"];
  user_id_type?: NonNullable<TaskGetPayload["params"]>["user_id_type"];
};

export type UpdateTaskParams = {
  task_guid: TaskUpdatePayload["path"]["task_guid"];
  task: TaskUpdateTask;
  update_fields?: TaskUpdateData["update_fields"];
  user_id_type?: NonNullable<TaskUpdatePayload["params"]>["user_id_type"];
};

export type CreateTaskCommentParams = {
  task_guid: string;
  content: TaskCommentCreatePayload["data"]["content"];
  reply_to_comment_id?: TaskCommentCreatePayload["data"]["reply_to_comment_id"];
  user_id_type?: NonNullable<TaskCommentCreatePayload["params"]>["user_id_type"];
};

export type ListTaskCommentsParams = {
  task_guid: string;
  page_size?: NonNullable<TaskCommentListPayload["params"]>["page_size"];
  page_token?: NonNullable<TaskCommentListPayload["params"]>["page_token"];
  direction?: NonNullable<TaskCommentListPayload["params"]>["direction"];
  user_id_type?: NonNullable<TaskCommentListPayload["params"]>["user_id_type"];
};

export type GetTaskCommentParams = {
  comment_id: TaskCommentGetPayload["path"]["comment_id"];
  user_id_type?: NonNullable<TaskCommentGetPayload["params"]>["user_id_type"];
};

export type UpdateTaskCommentParams = {
  comment_id: TaskCommentPatchPayload["path"]["comment_id"];
  comment: TaskCommentPatchComment;
  update_fields?: TaskCommentPatchData["update_fields"];
  user_id_type?: NonNullable<TaskCommentPatchPayload["params"]>["user_id_type"];
};

export type DeleteTaskCommentParams = {
  comment_id: TaskCommentDeletePayload["path"]["comment_id"];
};

export type UploadTaskAttachmentParams =
  | {
      task_guid: string;
      file_path: string;
      user_id_type?: NonNullable<TaskAttachmentUploadPayload["params"]>["user_id_type"];
    }
  | {
      task_guid: string;
      file_url: string;
      filename?: string;
      user_id_type?: NonNullable<TaskAttachmentUploadPayload["params"]>["user_id_type"];
    };

export type ListTaskAttachmentsParams = {
  task_guid: NonNullable<TaskAttachmentListPayload["params"]>["resource_id"];
  page_size?: NonNullable<TaskAttachmentListPayload["params"]>["page_size"];
  page_token?: NonNullable<TaskAttachmentListPayload["params"]>["page_token"];
  updated_mesc?: NonNullable<TaskAttachmentListPayload["params"]>["updated_mesc"];
  user_id_type?: NonNullable<TaskAttachmentListPayload["params"]>["user_id_type"];
};

export type GetTaskAttachmentParams = {
  attachment_guid: TaskAttachmentGetPayload["path"]["attachment_guid"];
  user_id_type?: NonNullable<TaskAttachmentGetPayload["params"]>["user_id_type"];
};

export type DeleteTaskAttachmentParams = {
  attachment_guid: NonNullable<TaskAttachmentDeletePayload["path"]>["attachment_guid"];
};

const TaskDateSchema = Type.Object({
  timestamp: Type.Optional(
    Type.String({
      description:
        'Unix timestamp in milliseconds (string), e.g. "1735689600000" (13-digit ms)',
    }),
  ),
  is_all_day: Type.Optional(Type.Boolean({ description: "Whether this is an all-day date" })),
});

const TaskMemberSchema = Type.Object({
  id: Type.String({ description: "Member ID (with type controlled by user_id_type)" }),
  type: Type.Optional(Type.String({ description: 'Member type (usually "user")' })),
  role: Type.String({ description: 'Member role, e.g. "assignee"' }),
  name: Type.Optional(Type.String({ description: "Optional display name" })),
});

const TasklistRefSchema = Type.Object({
  tasklist_guid: Type.Optional(Type.String({ description: "Tasklist GUID" })),
  section_guid: Type.Optional(Type.String({ description: "Section GUID in tasklist" })),
});

export const CreateTaskSchema = Type.Object({
  summary: Type.String({ description: "Task title/summary" }),
  description: Type.Optional(Type.String({ description: "Task description" })),
  due: Type.Optional(TaskDateSchema),
  start: Type.Optional(TaskDateSchema),
  extra: Type.Optional(Type.String({ description: "Custom opaque metadata string" })),
  completed_at: Type.Optional(
    Type.String({
      description: "Completion time as Unix timestamp in milliseconds (string, 13-digit ms)",
    }),
  ),
  members: Type.Optional(Type.Array(TaskMemberSchema, { description: "Initial task members" })),
  repeat_rule: Type.Optional(Type.String({ description: "Task repeat rule" })),
  tasklists: Type.Optional(
    Type.Array(TasklistRefSchema, { description: "Attach the task to tasklists/sections" }),
  ),
  mode: Type.Optional(Type.Number({ description: "Task mode value from Feishu Task API" })),
  is_milestone: Type.Optional(Type.Boolean({ description: "Whether task is a milestone" })),
  user_id_type: Type.Optional(
    Type.String({
      description: "User ID type for member IDs, e.g. open_id/user_id/union_id",
    }),
  ),
});

export const CreateSubtaskSchema = Type.Intersect([
  Type.Object({
    task_guid: Type.String({ description: "Parent task GUID" }),
  }),
  CreateTaskSchema,
]);

export const DeleteTaskSchema = Type.Object({
  task_guid: Type.String({ description: "Task GUID to delete" }),
});

export const GetTaskSchema = Type.Object({
  task_guid: Type.String({ description: "Task GUID to retrieve" }),
  user_id_type: Type.Optional(
    Type.String({
      description: "User ID type in returned members, e.g. open_id/user_id/union_id",
    }),
  ),
});

const TaskUpdateContentSchema = Type.Object(
  {
    summary: Type.Optional(Type.String({ description: "Updated summary" })),
    description: Type.Optional(Type.String({ description: "Updated description" })),
    due: Type.Optional(TaskDateSchema),
    start: Type.Optional(TaskDateSchema),
    extra: Type.Optional(Type.String({ description: "Updated extra metadata" })),
    completed_at: Type.Optional(
      Type.String({
        description: "Updated completion time (Unix timestamp in milliseconds, string, 13-digit ms)",
      }),
    ),
    repeat_rule: Type.Optional(Type.String({ description: "Updated repeat rule" })),
    mode: Type.Optional(Type.Number({ description: "Updated task mode" })),
    is_milestone: Type.Optional(Type.Boolean({ description: "Updated milestone flag" })),
  },
  { minProperties: 1 },
);

export const UpdateTaskSchema = Type.Object({
  task_guid: Type.String({ description: "Task GUID to update" }),
  task: TaskUpdateContentSchema,
  update_fields: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Fields to update. If omitted, this tool infers from keys in task (e.g. summary, description, due, start)",
      minItems: 1,
    }),
  ),
  user_id_type: Type.Optional(
    Type.String({
      description: "User ID type when task body contains user-related fields",
    }),
  ),
});

export const CreateTaskCommentSchema = Type.Object({
  task_guid: Type.String({ description: "Task GUID to comment on" }),
  content: Type.String({ description: "Comment content" }),
  reply_to_comment_id: Type.Optional(
    Type.String({ description: "Reply to a specific comment ID" }),
  ),
  user_id_type: Type.Optional(
    Type.String({ description: "User ID type when comment involves user-related fields" }),
  ),
});

export const ListTaskCommentsSchema = Type.Object({
  task_guid: Type.String({ description: "Task GUID to list comments for" }),
  page_size: Type.Optional(
    Type.Number({
      description: "Page size (1-100)",
      minimum: 1,
      maximum: 100,
    }),
  ),
  page_token: Type.Optional(Type.String({ description: "Pagination token" })),
  direction: Type.Optional(
    Type.Union([Type.Literal("asc"), Type.Literal("desc")], {
      description: "Sort direction",
    }),
  ),
  user_id_type: Type.Optional(
    Type.String({ description: "User ID type for returned creators" }),
  ),
});

export const GetTaskCommentSchema = Type.Object({
  comment_id: Type.String({ description: "Comment ID to retrieve" }),
  user_id_type: Type.Optional(
    Type.String({ description: "User ID type for returned creators" }),
  ),
});

const TaskCommentUpdateContentSchema = Type.Object(
  {
    content: Type.Optional(Type.String({ description: "Updated comment content" })),
  },
  { minProperties: 1 },
);

export const UpdateTaskCommentSchema = Type.Object({
  comment_id: Type.String({ description: "Comment ID to update" }),
  comment: TaskCommentUpdateContentSchema,
  update_fields: Type.Optional(
    Type.Array(Type.String(), {
      description: "Fields to update. If omitted, this tool infers from keys in comment (content)",
      minItems: 1,
    }),
  ),
  user_id_type: Type.Optional(
    Type.String({ description: "User ID type for returned creators" }),
  ),
});

export const DeleteTaskCommentSchema = Type.Object({
  comment_id: Type.String({ description: "Comment ID to delete" }),
});

export const UploadTaskAttachmentSchema = Type.Union([
  Type.Object({
    task_guid: Type.String({ description: "Task GUID to upload attachment to" }),
    file_path: Type.String({ description: "Local file path on the OpenClaw host" }),
    user_id_type: Type.Optional(
      Type.String({ description: "User ID type for returned uploader" }),
    ),
  }),
  Type.Object({
    task_guid: Type.String({ description: "Task GUID to upload attachment to" }),
    file_url: Type.String({ description: "Remote file URL to download and upload" }),
    filename: Type.Optional(Type.String({ description: "Override filename for uploaded attachment" })),
    user_id_type: Type.Optional(
      Type.String({ description: "User ID type for returned uploader" }),
    ),
  }),
]);

export const ListTaskAttachmentsSchema = Type.Object({
  task_guid: Type.String({ description: "Task GUID to list attachments for" }),
  page_size: Type.Optional(
    Type.Number({
      description: "Page size (1-100)",
      minimum: 1,
      maximum: 100,
    }),
  ),
  page_token: Type.Optional(Type.String({ description: "Pagination token" })),
  updated_mesc: Type.Optional(Type.String({ description: "Updated timestamp filter" })),
  user_id_type: Type.Optional(
    Type.String({ description: "User ID type for returned uploader" }),
  ),
});

export const GetTaskAttachmentSchema = Type.Object({
  attachment_guid: Type.String({ description: "Attachment GUID to retrieve" }),
  user_id_type: Type.Optional(
    Type.String({ description: "User ID type for returned uploader" }),
  ),
});

export const DeleteTaskAttachmentSchema = Type.Object({
  attachment_guid: Type.String({ description: "Attachment GUID to delete" }),
});
