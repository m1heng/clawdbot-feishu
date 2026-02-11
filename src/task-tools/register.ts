import type { TSchema } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { listEnabledFeishuAccounts } from "../accounts.js";
import { createFeishuClient } from "../client.js";
import { resolveToolsConfig } from "../tools-config.js";
import { createTask, deleteTask, getTask, updateTask } from "./actions.js";
import { errorResult, json, type TaskClient } from "./common.js";
import {
  CreateTaskSchema,
  type CreateTaskParams,
  DeleteTaskSchema,
  type DeleteTaskParams,
  GetTaskSchema,
  type GetTaskParams,
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
  getClient: () => TaskClient,
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
          return json(await spec.run(getClient(), params as P));
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

  const accounts = listEnabledFeishuAccounts(api.config);
  if (accounts.length === 0) {
    api.logger.debug?.("feishu_task: No Feishu accounts configured, skipping task tools");
    return;
  }

  const firstAccount = accounts[0];
  const toolsCfg = resolveToolsConfig(firstAccount.config.tools);
  if (!toolsCfg.task) {
    api.logger.debug?.("feishu_task: task tools disabled in config");
    return;
  }

  const getClient = () => createFeishuClient(firstAccount);

  registerTaskTool<CreateTaskParams>(api, getClient, {
    name: "feishu_task_create",
    label: "Feishu Task Create",
    description: "Create a Feishu task (task v2)",
    parameters: CreateTaskSchema,
    run: (client, params) => createTask(client, params),
  });

  registerTaskTool<DeleteTaskParams>(api, getClient, {
    name: "feishu_task_delete",
    label: "Feishu Task Delete",
    description: "Delete a Feishu task by task_guid (task v2)",
    parameters: DeleteTaskSchema,
    run: (client, { task_guid }) => deleteTask(client, task_guid),
  });

  registerTaskTool<GetTaskParams>(api, getClient, {
    name: "feishu_task_get",
    label: "Feishu Task Get",
    description: "Get Feishu task details by task_guid (task v2)",
    parameters: GetTaskSchema,
    run: (client, params) => getTask(client, params),
  });

  registerTaskTool<UpdateTaskParams>(api, getClient, {
    name: "feishu_task_update",
    label: "Feishu Task Update",
    description: "Update a Feishu task by task_guid (task v2 patch)",
    parameters: UpdateTaskSchema,
    run: (client, params) => updateTask(client, params),
  });

  api.logger.info?.("feishu_task: Registered 4 task tools");
}
