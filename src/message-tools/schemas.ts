import { Type, type Static } from "@sinclair/typebox";

function stringEnum<T extends readonly string[]>(
  values: T,
  options: { description?: string; default?: T[number] } = {},
) {
  return Type.Unsafe<T[number]>({ type: "string", enum: [...values], ...options });
}

const ACTION_VALUES = ["get", "list"] as const;
const SORT_VALUES = ["ByCreateTimeAsc", "ByCreateTimeDesc"] as const;

export const FeishuMessageSchema = Type.Object({
  action: stringEnum(ACTION_VALUES, {
    description:
      "Action to perform: get (get a single message by message_id), list (list recent messages in a chat by chat_id).",
  }),
  message_id: Type.Optional(
    Type.String({
      description: "Feishu message ID (e.g. om_xxx). Required for action=get.",
    }),
  ),
  chat_id: Type.Optional(
    Type.String({
      description: "Chat ID (e.g. oc_xxx). Required for action=list. Omit to use the current conversation's chat.",
    }),
  ),
  page_size: Type.Optional(
    Type.Integer({
      description: "Number of messages to fetch for action=list (default: 10, max: 50).",
      minimum: 1,
      maximum: 50,
      default: 10,
    }),
  ),
  sort_type: Type.Optional(
    stringEnum(SORT_VALUES, {
      description: "Sort order for action=list. Default: ByCreateTimeDesc (newest first).",
      default: "ByCreateTimeDesc",
    }),
  ),
});

export type FeishuMessageParams = Static<typeof FeishuMessageSchema>;
