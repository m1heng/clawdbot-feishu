import type { TSchema } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { hasFeishuToolEnabledForAnyAccount, withFeishuToolClient } from "../tools-common/tool-exec.js";
import {
  createSubtask,
  createTaskComment,
  createTask,
  deleteTaskComment,
  deleteTask,
  getTaskComment,
  getTask,
  listTaskComments,
  updateTaskComment,
  updateTask,
} from "./actions.js";
import { errorResult, json, type TaskClient } from "./common.js";
import {
  CreateSubtaskSchema,
  type CreateSubtaskParams,
  CreateTaskCommentSchema,
  type CreateTaskCommentParams,
  CreateTaskSchema,
  type CreateTaskParams,
  DeleteTaskCommentSchema,
  type DeleteTaskCommentParams,
  DeleteTaskSchema,
  type DeleteTaskParams,
  GetTaskCommentSchema,
  type GetTaskCommentParams,
  GetTaskSchema,
  type GetTaskParams,
  ListTaskCommentsSchema,
  type ListTaskCommentsParams,
  UpdateTaskCommentSchema,
  type UpdateTaskCommentParams,
  UpdateTaskSchema,
  type UpdateTaskParams,
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

  api.logger.debug?.("feishu_task: Registered task, subtask, and comment tools");
}
