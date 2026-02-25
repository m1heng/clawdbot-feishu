import { Type, type Static } from "@sinclair/typebox";

export const FeishuChatSchema = Type.Union([
  Type.Object({
    action: Type.Literal("get_announcement_info"),
    chat_id: Type.String({ description: "Chat ID to get announcement from" }),
  }),
  Type.Object({
    action: Type.Literal("get_announcement"),
    chat_id: Type.String({ description: "Chat ID to get announcement from" }),
  }),
  Type.Object({
    action: Type.Literal("write_announcement"),
    chat_id: Type.String({ description: "Chat ID to write announcement to" }),
    content: Type.String({ description: "Markdown content to write (replaces entire announcement)" }),
  }),
  Type.Object({
    action: Type.Literal("append_announcement"),
    chat_id: Type.String({ description: "Chat ID to append announcement to" }),
    content: Type.String({ description: "Markdown content to append to announcement" }),
  }),
  Type.Object({
    action: Type.Literal("list_announcement_blocks"),
    chat_id: Type.String({ description: "Chat ID to list announcement blocks from" }),
  }),
  Type.Object({
    action: Type.Literal("get_announcement_block"),
    chat_id: Type.String({ description: "Chat ID to get announcement block from" }),
    block_id: Type.String({ description: "Block ID (from list_announcement_blocks)" }),
  }),
  Type.Object({
    action: Type.Literal("update_announcement_block"),
    chat_id: Type.String({ description: "Chat ID to update announcement block in" }),
    block_id: Type.String({ description: "Block ID (from list_announcement_blocks)" }),
    content: Type.String({ description: "New text content" }),
  }),
  Type.Object({
    action: Type.Literal("delete_announcement_block"),
    chat_id: Type.String({ description: "Chat ID to delete announcement block from" }),
    block_id: Type.String({ description: "Block ID (from list_announcement_blocks)" }),
  }),
  // ============== New Chat Management Actions ==============
  Type.Object({
    action: Type.Literal("create_chat"),
    name: Type.String({ description: "Group chat name" }),
    user_ids: Type.Optional(Type.Array(Type.String(), { description: "List of user IDs to add to the group" })),
    description: Type.Optional(Type.String({ description: "Group chat description" })),
  }),
  Type.Object({
    action: Type.Literal("add_members"),
    chat_id: Type.String({ description: "Chat ID to add members to" }),
    user_ids: Type.Array(Type.String(), { description: "List of user IDs to add" }),
  }),
  Type.Object({
    action: Type.Literal("check_bot_in_chat"),
    chat_id: Type.String({ description: "Chat ID to check" }),
  }),
  Type.Object({
    action: Type.Literal("delete_chat"),
    chat_id: Type.String({ description: "Chat ID to delete/dismiss" }),
  }),
  Type.Object({
    action: Type.Literal("create_session_chat"),
    name: Type.String({ description: "Session group name" }),
    user_ids: Type.Array(Type.String(), { description: "List of user IDs to invite" }),
    greeting: Type.Optional(Type.String({ description: "Greeting message to send (default: Hello! I've created this group chat for us to collaborate.)" })),
    description: Type.Optional(Type.String({ description: "Group description" })),
  }),
]);

export type FeishuChatParams = Static<typeof FeishuChatSchema>;
