import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { ResolvedFeishuAccount } from "../types.js";
import { hasFeishuToolEnabledForAnyAccount, withFeishuToolClient } from "../tools-common/tool-exec.js";
import { runChatAction } from "./actions.js";
import { errorResult, json, type ChatClient } from "./common.js";
import { FeishuChatSchema, type FeishuChatParams } from "./schemas.js";

type ChatToolSpec<P> = {
  name: string;
  label: string;
  description: string;
  parameters: any;
  requiredTool?: "chat";
  run: (args: { client: ChatClient; account: ResolvedFeishuAccount }, params: P) => Promise<unknown>;
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
            requiredTool: spec.requiredTool,
            run: async ({ client, account }) =>
              json(await spec.run({ client: client as ChatClient, account }, params as P)),
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

  const chatEnabled = hasFeishuToolEnabledForAnyAccount(api.config, "chat");
  const registered: string[] = [];

  if (chatEnabled) {
    registerChatTool<FeishuChatParams>(api, {
      name: "feishu_chat",
      label: "Feishu Chat",
      description:
        "Feishu chat operations. Actions: get_announcement, get_announcement_info, list_announcement_blocks, get_announcement_block. Use to read group announcements.",
      parameters: FeishuChatSchema,
      requiredTool: "chat",
      run: async ({ client }, params) => runChatAction(client, params),
    });
    registered.push("feishu_chat");
  }

  if (registered.length > 0) {
    api.logger.debug?.(`feishu_chat: Registered ${registered.join(", ")}`);
  }
}
