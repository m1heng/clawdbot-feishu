import type * as Lark from "@larksuiteoapi/node-sdk";
import { runFeishuApiCall, type FeishuApiResponse } from "../tools-common/feishu-api.js";

/**
 * Urgency type for Feishu urgent messages.
 * - "app": In-app buzz notification (default, no extra cost)
 * - "sms": SMS push to the recipient's phone
 * - "phone": Voice call to the recipient's phone
 */
export type FeishuUrgentType = "app" | "sms" | "phone";

type UrgentPayload = {
  data: { user_id_list: string[] };
  params: { user_id_type: "open_id" | "user_id" | "union_id" };
  path: { message_id: string };
};

interface UrgentResponse extends FeishuApiResponse {
  data?: { invalid_user_id_list?: string[] };
}

type LarkMessageWithUrgent = Lark.Client["im"]["message"] & {
  urgentApp?: (payload: UrgentPayload) => Promise<UrgentResponse>;
  urgentSms?: (payload: UrgentPayload) => Promise<UrgentResponse>;
  urgentPhone?: (payload: UrgentPayload) => Promise<UrgentResponse>;
};

/**
 * Send an urgent (buzz) notification for an existing Feishu message.
 *
 * Calls the Feishu "urgent" API which sends a strong push notification
 * to the specified recipients. The message must already be sent.
 *
 * Requires `im:message.urgent` scope (or `im:message.urgent:sms` / `im:message.urgent:phone` variants).
 *
 * Common errors:
 * - Code 230024: Quota exceeded ("Reach the upper limit of urgent message").
 *   Check tenant quota in Feishu admin console > Cost Center.
 * - Invalid user IDs cause HTTP 400 with descriptive message (not returned in
 *   `invalid_user_id_list` as documented).
 *
 * @see https://open.feishu.cn/document/server-docs/im-v1/message/urgent_app
 * @see https://open.feishu.cn/document/server-docs/im-v1/message/urgent_sms
 * @see https://open.feishu.cn/document/server-docs/im-v1/message/urgent_phone
 */
export async function urgentMessageFeishu(params: {
  client: Lark.Client;
  messageId: string;
  userIds: string[];
  urgentType?: FeishuUrgentType;
}): Promise<{ invalidUserList: string[] }> {
  const { client, messageId, userIds, urgentType = "app" } = params;

  const larkMessage = client.im.message as LarkMessageWithUrgent;

  const payload: UrgentPayload = {
    path: { message_id: messageId },
    params: { user_id_type: "open_id" },
    data: { user_id_list: userIds },
  };

  const methodMap = {
    app: larkMessage.urgentApp?.bind(larkMessage),
    sms: larkMessage.urgentSms?.bind(larkMessage),
    phone: larkMessage.urgentPhone?.bind(larkMessage),
  } as const;

  const method = methodMap[urgentType];
  if (typeof method !== "function") {
    throw new Error(
      `Feishu urgent: SDK method not available for urgentType="${urgentType}". ` +
        `Check that @larksuiteoapi/node-sdk is up to date.`,
    );
  }

  const response = await runFeishuApiCall<UrgentResponse>(
    `Feishu urgent message (${urgentType})`,
    () => method(payload),
  );

  return {
    invalidUserList: response.data?.invalid_user_id_list ?? [],
  };
}
