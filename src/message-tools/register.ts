import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { hasFeishuToolEnabledForAnyAccount, withFeishuToolClient } from "../tools-common/tool-exec.js";
import { getCurrentFeishuToolContext } from "../tools-common/tool-context.js";
import { errorResult, json } from "../tools-common/feishu-api.js";
import { runMessageAction } from "./actions.js";
import { FeishuMessageSchema, type FeishuMessageParams } from "./schemas.js";

export function registerFeishuMessageTools(api: OpenClawPluginApi) {
  if (!api.config) {
    api.logger.debug?.("feishu_message: No config available, skipping");
    return;
  }

  if (!hasFeishuToolEnabledForAnyAccount(api.config)) {
    api.logger.debug?.("feishu_message: No Feishu accounts configured, skipping");
    return;
  }

  if (!hasFeishuToolEnabledForAnyAccount(api.config, "message")) {
    api.logger.debug?.("feishu_message: message tool disabled in config");
    return;
  }

  api.registerTool(
    {
      name: "feishu_message",
      label: "Feishu Message",
      description:
        "Read Feishu messages. Actions: get (get a single message by message_id), list (list recent messages in a chat). " +
        "Use list to discover message_ids for use with other tools (e.g., feishu_reaction).",
      parameters: FeishuMessageSchema,
      async execute(_toolCallId, params) {
        const p = params as FeishuMessageParams;
        if (p.action === "list") {
          const isValidChatId = p.chat_id?.startsWith("oc_");
          if (!isValidChatId) {
            const ctx = getCurrentFeishuToolContext();
            if (ctx?.chatId) p.chat_id = ctx.chatId;
          }
        }

        try {
          return await withFeishuToolClient({
            api,
            toolName: "feishu_message",
            requiredTool: "message",
            run: async ({ client }) => json(await runMessageAction(client, p)),
          });
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    { name: "feishu_message" },
  );

  api.logger.debug?.("feishu_message: Registered feishu_message tool");
}
