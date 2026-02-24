import type { TSchema } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { hasFeishuToolEnabledForAnyAccount, withFeishuToolClient } from "../tools-common/tool-exec.js";
import { runChatAction } from "./actions.js";
import { errorResult, json, type ChatClient } from "./common.js";
import { FeishuChatSchema, type FeishuChatParams } from "./schemas.js";

type ChatToolSpec<P> = {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  run: (client: ChatClient, params: P) => Promise<unknown>;
};

function registerChatTool<P>(api: OpenClawPluginApi, spec: ChatToolSpec<P>) {
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
            requiredTool: "chat",
            run: async ({ client }) => json(await spec.run(client as ChatClient, params as P)),
          });
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    { name: spec.name },
  );
}

export function registerFeishuChatTools(api: OpenClawPluginApi) {
  if (!api.config) {
    api.logger.debug?.("feishu_chat: No config available, skipping chat tools");
    return;
  }

  if (!hasFeishuToolEnabledForAnyAccount(api.config)) {
    api.logger.debug?.("feishu_chat: No Feishu accounts configured, skipping chat tools");
    return;
  }

  if (!hasFeishuToolEnabledForAnyAccount(api.config, "chat")) {
    api.logger.debug?.("feishu_chat: chat tool disabled in config");
    return;
  }

  registerChatTool<FeishuChatParams>(api, {
    name: "feishu_chat",
    label: "Feishu Chat",
    description:
      "Feishu group chat operations. Actions: group_chat_create, group_chat_create_session, group_chat_add_members, group_chat_is_in_chat. Supports creating groups, one-step session groups, and adding specified bots/users.",
    parameters: FeishuChatSchema,
    run: (client, params) => runChatAction(client, params),
  });

  api.logger.debug?.("feishu_chat: Registered feishu_chat tool");
}
