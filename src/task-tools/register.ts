import type { TSchema } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { ResolvedFeishuAccount } from "../types.js";
import { hasFeishuToolEnabledForAnyAccount, withFeishuToolClient } from "../tools-common/tool-exec.js";
import {
  createSubtask,
  createTask,
  deleteTaskAttachment,
  deleteTask,
  getTaskAttachment,
  getTask,
  listTaskAttachments,
  uploadTaskAttachment,
  updateTask,
} from "./actions.js";
import { errorResult, json, type TaskClient } from "./common.js";
import {
  CreateSubtaskSchema,
  type CreateSubtaskParams,
  CreateTaskSchema,
  type CreateTaskParams,
  DeleteTaskAttachmentSchema,
  type DeleteTaskAttachmentParams,
  DeleteTaskSchema,
  type DeleteTaskParams,
  GetTaskAttachmentSchema,
  type GetTaskAttachmentParams,
  GetTaskSchema,
  type GetTaskParams,
  ListTaskAttachmentsSchema,
  type ListTaskAttachmentsParams,
  UploadTaskAttachmentSchema,
  type UploadTaskAttachmentParams,
  UpdateTaskSchema,
  type UpdateTaskParams,
} from "./schemas.js";
import { BYTES_PER_MEGABYTE, DEFAULT_TASK_MEDIA_MAX_MB } from "./constants.js";

type TaskToolSpec<P> = {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  run: (args: { client: TaskClient; account: ResolvedFeishuAccount }, params: P) => Promise<unknown>;
};

function registerTaskTool<P>(api: OpenClawPluginApi, spec: TaskToolSpec<P>) {
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
            run: async ({ client, account }) =>
              json(await spec.run({ client: client as TaskClient, account }, params as P)),
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
    run: async ({ client }, params) => createTask(client, params),
  });

  registerTaskTool<CreateSubtaskParams>(api, {
    name: "feishu_task_subtask_create",
    label: "Feishu Task Subtask Create",
    description: "Create a Feishu subtask under a parent task (task v2)",
    parameters: CreateSubtaskSchema,
    run: async ({ client }, params) => createSubtask(client, params),
  });

  registerTaskTool<UploadTaskAttachmentParams>(api, {
    name: "feishu_task_attachment_upload",
    label: "Feishu Task Attachment Upload",
    description: "Upload an attachment to a Feishu task (task v2)",
    parameters: UploadTaskAttachmentSchema,
    run: async ({ client, account }, params) => {
      const mediaMaxBytes = (account.config?.mediaMaxMb ?? DEFAULT_TASK_MEDIA_MAX_MB) * BYTES_PER_MEGABYTE;
      return uploadTaskAttachment(client, params, { maxBytes: mediaMaxBytes });
    },
  });

  registerTaskTool<ListTaskAttachmentsParams>(api, {
    name: "feishu_task_attachment_list",
    label: "Feishu Task Attachment List",
    description: "List attachments for a Feishu task (task v2)",
    parameters: ListTaskAttachmentsSchema,
    run: async ({ client }, params) => listTaskAttachments(client, params),
  });

  registerTaskTool<GetTaskAttachmentParams>(api, {
    name: "feishu_task_attachment_get",
    label: "Feishu Task Attachment Get",
    description: "Get a Feishu task attachment by attachment_guid (task v2)",
    parameters: GetTaskAttachmentSchema,
    run: async ({ client }, params) => getTaskAttachment(client, params),
  });

  registerTaskTool<DeleteTaskAttachmentParams>(api, {
    name: "feishu_task_attachment_delete",
    label: "Feishu Task Attachment Delete",
    description: "Delete a Feishu task attachment by attachment_guid (task v2)",
    parameters: DeleteTaskAttachmentSchema,
    run: async ({ client }, params) => deleteTaskAttachment(client, params),
  });

  registerTaskTool<DeleteTaskParams>(api, {
    name: "feishu_task_delete",
    label: "Feishu Task Delete",
    description: "Delete a Feishu task by task_guid (task v2)",
    parameters: DeleteTaskSchema,
    run: async ({ client }, { task_guid }) => deleteTask(client, task_guid),
  });

  registerTaskTool<GetTaskParams>(api, {
    name: "feishu_task_get",
    label: "Feishu Task Get",
    description: "Get Feishu task details by task_guid (task v2)",
    parameters: GetTaskSchema,
    run: async ({ client }, params) => getTask(client, params),
  });

  registerTaskTool<UpdateTaskParams>(api, {
    name: "feishu_task_update",
    label: "Feishu Task Update",
    description: "Update a Feishu task by task_guid (task v2 patch)",
    parameters: UpdateTaskSchema,
    run: async ({ client }, params) => updateTask(client, params),
  });

  api.logger.debug?.("feishu_task: Registered task, subtask, and attachment tools");
}
