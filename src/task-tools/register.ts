import type { TSchema } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { hasFeishuToolEnabledForAnyAccount, withFeishuToolClient } from "../tools-common/tool-exec.js";
import {
  addTaskToTasklist,
  addTasklistMembers,
  createSubtask,
  createTaskComment,
  createTask,
  createTasklist,
  deleteTaskAttachment,
  deleteTaskComment,
  deleteTask,
  deleteTasklist,
  getTaskAttachment,
  getTaskComment,
  getTask,
  getTasklist,
  listTaskAttachments,
  listTaskComments,
  listTasklists,
  removeTaskFromTasklist,
  removeTasklistMembers,
  uploadTaskAttachment,
  updateTaskComment,
  updateTask,
  updateTasklist,
} from "./actions.js";
import { errorResult, json, type TaskClient } from "./common.js";
import {
  AddTaskToTasklistSchema,
  type AddTaskToTasklistParams,
  AddTasklistMembersSchema,
  type AddTasklistMembersParams,
  CreateSubtaskSchema,
  type CreateSubtaskParams,
  CreateTaskCommentSchema,
  type CreateTaskCommentParams,
  CreateTaskSchema,
  type CreateTaskParams,
  CreateTasklistSchema,
  type CreateTasklistParams,
  DeleteTaskAttachmentSchema,
  type DeleteTaskAttachmentParams,
  DeleteTaskCommentSchema,
  type DeleteTaskCommentParams,
  DeleteTaskSchema,
  type DeleteTaskParams,
  DeleteTasklistSchema,
  type DeleteTasklistParams,
  GetTaskAttachmentSchema,
  type GetTaskAttachmentParams,
  GetTaskCommentSchema,
  type GetTaskCommentParams,
  GetTaskSchema,
  type GetTaskParams,
  GetTasklistSchema,
  type GetTasklistParams,
  ListTaskAttachmentsSchema,
  type ListTaskAttachmentsParams,
  ListTaskCommentsSchema,
  type ListTaskCommentsParams,
  ListTasklistsSchema,
  type ListTasklistsParams,
  RemoveTaskFromTasklistSchema,
  type RemoveTaskFromTasklistParams,
  RemoveTasklistMembersSchema,
  type RemoveTasklistMembersParams,
  UpdateTaskCommentSchema,
  type UpdateTaskCommentParams,
  UpdateTaskSchema,
  type UpdateTaskParams,
  UpdateTasklistSchema,
  type UpdateTasklistParams,
  UploadTaskAttachmentSchema,
  type UploadTaskAttachmentParams,
} from "./schemas.js";

type ToolSpec<P> = {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  run: (client: TaskClient, params: P) => Promise<unknown>;
};

function registerTaskTool<P>(
  api: OpenClawPluginApi,
  spec: ToolSpec<P>,
) {
  api.registerTool(
    {
      name: spec.name,
      label: spec.label,
      description: spec.description,
      parameters: spec.parameters,
      async execute(_toolCallId, params) {
        try {
          return await withFeishuToolClient({
            api,
            toolName: spec.name,
            requiredTool: "task",
            run: async ({ client }) => json(await spec.run(client as TaskClient, params as P)),
          });
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    { name: spec.name },
  );
}

export function registerFeishuTaskTools(api: OpenClawPluginApi) {
  if (!api.config) {
    api.logger.debug?.("feishu_task: No config available, skipping task tools");
    return;
  }

  if (!hasFeishuToolEnabledForAnyAccount(api.config)) {
    api.logger.debug?.("feishu_task: No Feishu accounts configured, skipping task tools");
    return;
  }

  if (!hasFeishuToolEnabledForAnyAccount(api.config, "task")) {
    api.logger.debug?.("feishu_task: task tools disabled in config");
    return;
  }

  registerTaskTool<CreateTaskParams>(api, {
    name: "feishu_task_create",
    label: "Feishu Task Create",
    description: "Create a Feishu task (task v2)",
    parameters: CreateTaskSchema,
    run: (client, params) => createTask(client, params),
  });

  registerTaskTool<CreateSubtaskParams>(api, {
    name: "feishu_task_subtask_create",
    label: "Feishu Task Subtask Create",
    description: "Create a Feishu subtask under a parent task (task v2)",
    parameters: CreateSubtaskSchema,
    run: (client, params) => createSubtask(client, params),
  });

  registerTaskTool<CreateTaskCommentParams>(api, {
    name: "feishu_task_comment_create",
    label: "Feishu Task Comment Create",
    description: "Create a comment for a Feishu task (task v2)",
    parameters: CreateTaskCommentSchema,
    run: (client, params) => createTaskComment(client, params),
  });

  registerTaskTool<ListTaskCommentsParams>(api, {
    name: "feishu_task_comment_list",
    label: "Feishu Task Comment List",
    description: "List comments for a Feishu task (task v2)",
    parameters: ListTaskCommentsSchema,
    run: (client, params) => listTaskComments(client, params),
  });

  registerTaskTool<GetTaskCommentParams>(api, {
    name: "feishu_task_comment_get",
    label: "Feishu Task Comment Get",
    description: "Get a Feishu task comment by comment_id (task v2)",
    parameters: GetTaskCommentSchema,
    run: (client, params) => getTaskComment(client, params),
  });

  registerTaskTool<UpdateTaskCommentParams>(api, {
    name: "feishu_task_comment_update",
    label: "Feishu Task Comment Update",
    description: "Update a Feishu task comment by comment_id (task v2 patch)",
    parameters: UpdateTaskCommentSchema,
    run: (client, params) => updateTaskComment(client, params),
  });

  registerTaskTool<DeleteTaskCommentParams>(api, {
    name: "feishu_task_comment_delete",
    label: "Feishu Task Comment Delete",
    description: "Delete a Feishu task comment by comment_id (task v2)",
    parameters: DeleteTaskCommentSchema,
    run: (client, params) => deleteTaskComment(client, params),
  });

  registerTaskTool<UploadTaskAttachmentParams>(api, {
    name: "feishu_task_attachment_upload",
    label: "Feishu Task Attachment Upload",
    description: "Upload an attachment to a Feishu task (task v2)",
    parameters: UploadTaskAttachmentSchema,
    run: (client, params) => uploadTaskAttachment(client, params),
  });

  registerTaskTool<ListTaskAttachmentsParams>(api, {
    name: "feishu_task_attachment_list",
    label: "Feishu Task Attachment List",
    description: "List attachments for a Feishu task (task v2)",
    parameters: ListTaskAttachmentsSchema,
    run: (client, params) => listTaskAttachments(client, params),
  });

  registerTaskTool<GetTaskAttachmentParams>(api, {
    name: "feishu_task_attachment_get",
    label: "Feishu Task Attachment Get",
    description: "Get a Feishu task attachment by attachment_guid (task v2)",
    parameters: GetTaskAttachmentSchema,
    run: (client, params) => getTaskAttachment(client, params),
  });

  registerTaskTool<DeleteTaskAttachmentParams>(api, {
    name: "feishu_task_attachment_delete",
    label: "Feishu Task Attachment Delete",
    description: "Delete a Feishu task attachment by attachment_guid (task v2)",
    parameters: DeleteTaskAttachmentSchema,
    run: (client, params) => deleteTaskAttachment(client, params),
  });

  registerTaskTool<DeleteTaskParams>(api, {
    name: "feishu_task_delete",
    label: "Feishu Task Delete",
    description: "Delete a Feishu task by task_guid (task v2)",
    parameters: DeleteTaskSchema,
    run: (client, { task_guid }) => deleteTask(client, task_guid),
  });

  registerTaskTool<GetTaskParams>(api, {
    name: "feishu_task_get",
    label: "Feishu Task Get",
    description: "Get Feishu task details by task_guid (task v2)",
    parameters: GetTaskSchema,
    run: (client, params) => getTask(client, params),
  });

  registerTaskTool<UpdateTaskParams>(api, {
    name: "feishu_task_update",
    label: "Feishu Task Update",
    description: "Update a Feishu task by task_guid (task v2 patch)",
    parameters: UpdateTaskSchema,
    run: (client, params) => updateTask(client, params),
  });

  registerTaskTool<AddTaskToTasklistParams>(api, {
    name: "feishu_task_add_tasklist",
    label: "Feishu Task Add Tasklist",
    description: "Add a task into a tasklist (task v2)",
    parameters: AddTaskToTasklistSchema,
    run: (client, params) => addTaskToTasklist(client, params),
  });

  registerTaskTool<RemoveTaskFromTasklistParams>(api, {
    name: "feishu_task_remove_tasklist",
    label: "Feishu Task Remove Tasklist",
    description: "Remove a task from a tasklist (task v2)",
    parameters: RemoveTaskFromTasklistSchema,
    run: (client, params) => removeTaskFromTasklist(client, params),
  });

  registerTaskTool<CreateTasklistParams>(api, {
    name: "feishu_tasklist_create",
    label: "Feishu Tasklist Create",
    description: "Create a Feishu tasklist (task v2)",
    parameters: CreateTasklistSchema,
    run: (client, params) => createTasklist(client, params),
  });

  registerTaskTool<GetTasklistParams>(api, {
    name: "feishu_tasklist_get",
    label: "Feishu Tasklist Get",
    description: "Get a Feishu tasklist by tasklist_guid (task v2)",
    parameters: GetTasklistSchema,
    run: (client, params) => getTasklist(client, params),
  });

  registerTaskTool<ListTasklistsParams>(api, {
    name: "feishu_tasklist_list",
    label: "Feishu Tasklist List",
    description: "List Feishu tasklists (task v2)",
    parameters: ListTasklistsSchema,
    run: (client, params) => listTasklists(client, params),
  });

  registerTaskTool<UpdateTasklistParams>(api, {
    name: "feishu_tasklist_update",
    label: "Feishu Tasklist Update",
    description: "Update a Feishu tasklist by tasklist_guid (task v2 patch)",
    parameters: UpdateTasklistSchema,
    run: (client, params) => updateTasklist(client, params),
  });

  registerTaskTool<DeleteTasklistParams>(api, {
    name: "feishu_tasklist_delete",
    label: "Feishu Tasklist Delete",
    description: "Delete a Feishu tasklist by tasklist_guid (task v2)",
    parameters: DeleteTasklistSchema,
    run: (client, { tasklist_guid }) => deleteTasklist(client, tasklist_guid),
  });

  registerTaskTool<AddTasklistMembersParams>(api, {
    name: "feishu_tasklist_add_members",
    label: "Feishu Tasklist Add Members",
    description: "Add members to a Feishu tasklist (task v2)",
    parameters: AddTasklistMembersSchema,
    run: (client, params) => addTasklistMembers(client, params),
  });

  registerTaskTool<RemoveTasklistMembersParams>(api, {
    name: "feishu_tasklist_remove_members",
    label: "Feishu Tasklist Remove Members",
    description: "Remove members from a Feishu tasklist (task v2)",
    parameters: RemoveTasklistMembersSchema,
    run: (client, params) => removeTasklistMembers(client, params),
  });

  api.logger.debug?.("feishu_task: Registered task, tasklist, and membership tools");
}
