import type { TSchema } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { hasFeishuToolEnabledForAnyAccount, withFeishuToolClient } from "../tools-common/tool-exec.js";
import { runPermAction } from "./actions.js";
import { errorResult, json, type PermClient } from "./common.js";
import { FeishuPermSchema, type FeishuPermParams } from "./schemas.js";

type PermToolSpec<P> = {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  run: (client: PermClient, params: P) => Promise<unknown>;
};

function registerPermTool<P>(api: OpenClawPluginApi, spec: PermToolSpec<P>) {
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
            requiredTool: "perm",
            run: async ({ client }) => json(await spec.run(client as PermClient, params as P)),
          });
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    { name: spec.name },
  );
}

export function registerFeishuPermTools(api: OpenClawPluginApi) {
  if (!api.config) {
    api.logger.debug?.("feishu_perm: No config available, skipping perm tools");
    return;
  }

  if (!hasFeishuToolEnabledForAnyAccount(api.config)) {
    api.logger.debug?.("feishu_perm: No Feishu accounts configured, skipping perm tools");
    return;
  }

  if (!hasFeishuToolEnabledForAnyAccount(api.config, "perm")) {
    api.logger.debug?.("feishu_perm: perm tool disabled in config (default: false)");
    return;
  }

  registerPermTool<FeishuPermParams>(api, {
    name: "feishu_perm",
    label: "Feishu Perm",
    description: "Feishu permission management. Actions: list, add, remove",
    parameters: FeishuPermSchema,
    run: (client, params) => runPermAction(client, params),
  });

  api.logger.debug?.("feishu_perm: Registered feishu_perm tool");
}
