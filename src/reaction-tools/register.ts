import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { hasFeishuToolEnabledForAnyAccount, withFeishuToolClient } from "../tools-common/tool-exec.js";
import { errorResult, json } from "../tools-common/feishu-api.js";
import { runReactionAction } from "./actions.js";
import { FeishuReactionSchema, type FeishuReactionParams } from "./schemas.js";

export function registerFeishuReactionTools(api: OpenClawPluginApi) {
  if (!api.config) {
    api.logger.debug?.("feishu_reaction: No config available, skipping");
    return;
  }

  if (!hasFeishuToolEnabledForAnyAccount(api.config)) {
    api.logger.debug?.("feishu_reaction: No Feishu accounts configured, skipping");
    return;
  }

  if (!hasFeishuToolEnabledForAnyAccount(api.config, "reaction")) {
    api.logger.debug?.("feishu_reaction: reaction tool disabled in config");
    return;
  }

  api.registerTool(
    {
      name: "feishu_reaction",
      label: "Feishu Reaction",
      description:
        "Add, remove, or list emoji reactions on Feishu messages. " +
        "Supported actions: add (add an emoji reaction), remove (remove a reaction by ID), list (list all reactions). " +
        "Common emoji types: THUMBSUP, THUMBSDOWN, HEART, SMILE, GRINNING, FIRE, CLAP, OK, CHECK, CROSS, PARTY, PRAY. " +
        "To react to a previous message, first use feishu_message list to find the target message_id.",
      parameters: FeishuReactionSchema,
      async execute(_toolCallId, params) {
        const p = params as FeishuReactionParams;
        try {
          return await withFeishuToolClient({
            api,
            toolName: "feishu_reaction",
            requiredTool: "reaction",
            run: async ({ client }) => json(await runReactionAction(client, p)),
          });
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    { name: "feishu_reaction" },
  );

  api.logger.debug?.("feishu_reaction: Registered feishu_reaction tool");
}
