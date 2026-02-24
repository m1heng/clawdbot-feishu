import { Type, type Static } from "@sinclair/typebox";

const GroupMessageType = Type.Union([Type.Literal("chat"), Type.Literal("thread")]);

const UserIdType = Type.Union([Type.Literal("open_id"), Type.Literal("user_id"), Type.Literal("union_id")]);

const MemberIdType = Type.Union([
  Type.Literal("open_id"),
  Type.Literal("user_id"),
  Type.Literal("union_id"),
  Type.Literal("app_id"),
]);

export const FeishuChatSchema = Type.Union([
  Type.Object({
    action: Type.Literal("group_chat_create"),
    name: Type.String({ description: "Group name" }),
    description: Type.Optional(Type.String({ description: "Group description" })),
    owner_id: Type.Optional(Type.String({ description: "Owner user ID" })),
    user_id_type: Type.Optional(UserIdType),
    user_id_list: Type.Optional(Type.Array(Type.String(), { description: "Initial user IDs to add when creating the group" })),
    bot_id_list: Type.Optional(Type.Array(Type.String(), { description: "Initial bot app IDs to add when creating the group" })),
    set_bot_manager: Type.Optional(Type.Boolean({ description: "Whether to set the calling bot as group manager" })),
    group_message_type: Type.Optional(GroupMessageType),
    uuid: Type.Optional(Type.String({ description: "Idempotency key for create request (up to 50 chars)" })),
  }),
  Type.Object({
    action: Type.Literal("group_chat_add_members"),
    chat_id: Type.String({ description: "Target group chat ID" }),
    id_list: Type.Array(Type.String(), {
      description: "Member IDs to add. Use app_id when adding bots.",
      minItems: 1,
    }),
    member_id_type: Type.Optional(MemberIdType),
    succeed_type: Type.Optional(Type.Number({ description: "Success mode from Feishu API (optional, usually omit)" })),
  }),
  Type.Object({
    action: Type.Literal("group_chat_is_in_chat"),
    chat_id: Type.String({ description: "Target group chat ID" }),
  }),
]);

export type FeishuChatParams = Static<typeof FeishuChatSchema>;
