import { Type, type Static } from "@sinclair/typebox";

function stringEnum<T extends readonly string[]>(
  values: T,
  options: { description?: string; default?: T[number] } = {},
) {
  return Type.Unsafe<T[number]>({ type: "string", enum: [...values], ...options });
}

const CHAT_ACTION_VALUES = [
  "get_announcement_info",
  "get_announcement",
  "write_announcement",
  "append_announcement",
  "list_announcement_blocks",
  "get_announcement_block",
  "update_announcement_block",
  "create_chat",
  "add_members",
  "check_bot_in_chat",
  "delete_chat",
  "create_session_chat",
] as const;

const USER_ID_TYPE_VALUES = ["open_id", "user_id", "union_id"] as const;
const MEMBER_ID_TYPE_VALUES = ["open_id", "user_id", "union_id", "app_id"] as const;

export const FeishuChatSchema = Type.Object({
  action: stringEnum(CHAT_ACTION_VALUES, { description: "Chat action" }),
  chat_id: Type.Optional(Type.String({ description: "Chat ID" })),
  content: Type.Optional(Type.String({ description: "Announcement content / block content" })),
  block_id: Type.Optional(Type.String({ description: "Announcement block ID" })),

  name: Type.Optional(Type.String({ description: "Group chat name" })),
  user_ids: Type.Optional(
    Type.Array(Type.String(), {
      description: "User/member IDs used by create_chat/add_members/create_session_chat",
    }),
  ),
  user_id_type: Type.Optional(
    stringEnum(USER_ID_TYPE_VALUES, {
      description: "ID type for user_ids in create_chat/create_session_chat",
      default: "open_id",
    }),
  ),
  member_id_type: Type.Optional(
    stringEnum(MEMBER_ID_TYPE_VALUES, {
      description: "ID type for add_members (supports app_id for bots)",
      default: "open_id",
    }),
  ),
  greeting: Type.Optional(
    Type.String({
      description:
        "Greeting message for create_session_chat (default: Hello! I've created this group chat for us to collaborate.)",
    }),
  ),
  description: Type.Optional(Type.String({ description: "Group chat description" })),
});

export type FeishuChatParams = Static<typeof FeishuChatSchema>;
