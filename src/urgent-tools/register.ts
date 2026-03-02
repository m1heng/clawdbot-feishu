import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { hasFeishuToolEnabledForAnyAccount, withFeishuToolClient } from "../tools-common/tool-exec.js";
import { errorResult, json } from "../tools-common/feishu-api.js";
import { urgentMessageFeishu } from "./actions.js";
import { FeishuUrgentSchema, type FeishuUrgentParams } from "./schemas.js";

export function registerFeishuUrgentTools(api: OpenClawPluginApi) {
  if (!api.config) {
    api.logger.debug?.("feishu_urgent: No config available, skipping");
    return;
  }

  if (!hasFeishuToolEnabledForAnyAccount(api.config)) {
    api.logger.debug?.("feishu_urgent: No Feishu accounts configured, skipping");
    return;
  }

  if (!hasFeishuToolEnabledForAnyAccount(api.config, "urgent")) {
    api.logger.debug?.("feishu_urgent: urgent tool disabled in config");
    return;
  }

  api.registerTool(
    {
      name: "feishu_urgent",
      label: "Feishu Urgent",
      description:
        "Send an urgent (buzz) notification for an existing Feishu message. " +
        "Supported urgent_type values: app (in-app buzz, default), sms (SMS push), phone (voice call). " +
        "Requires the message_id of an already-sent message and the open_id list of recipients to buzz. " +
        "Use this to escalate important messages that require immediate attention.",
      parameters: FeishuUrgentSchema,
      async execute(_toolCallId, params) {
        const p = params as FeishuUrgentParams;
        try {
          return await withFeishuToolClient({
            api,
            toolName: "feishu_urgent",
            requiredTool: "urgent",
            run: async ({ client }) => {
              const result = await urgentMessageFeishu({
                client,
                messageId: p.message_id,
                userIds: p.user_ids,
                urgentType: p.urgent_type ?? "app",
              });
              return json({
                ok: true,
                message_id: p.message_id,
                urgent_type: p.urgent_type ?? "app",
                invalid_user_list: result.invalidUserList,
              });
            },
          });
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    { name: "feishu_urgent" },
  );

  api.logger.debug?.("feishu_urgent: Registered feishu_urgent tool");
}
