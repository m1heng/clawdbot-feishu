import { Type, type Static } from "@sinclair/typebox";

function stringEnum<T extends readonly string[]>(
  values: T,
  options: { description?: string; default?: T[number] } = {},
) {
  return Type.Unsafe<T[number]>({ type: "string", enum: [...values], ...options });
}

const ACTION_VALUES = ["add", "remove", "list"] as const;

export const FeishuReactionSchema = Type.Object({
  action: stringEnum(ACTION_VALUES, {
    description:
      "Action to perform: add (add emoji reaction to a message), remove (remove a reaction by reaction_id), list (list all reactions on a message).",
  }),
  message_id: Type.String({
    description: "Feishu message ID (e.g. om_xxx). Use feishu_message list to find message_ids from chat history.",
  }),
  emoji_type: Type.Optional(
    Type.String({
      description:
        "Emoji type to add or filter by (e.g. THUMBSUP, HEART, SMILE, GRINNING, FIRE, CLAP, OK, CHECK, CROSS). " +
        "Required for action=add. Optional filter for action=list.",
    }),
  ),
  reaction_id: Type.Optional(
    Type.String({
      description: "Reaction ID to remove. Required for action=remove. Obtained from add or list results.",
    }),
  ),
});

export type FeishuReactionParams = Static<typeof FeishuReactionSchema>;
