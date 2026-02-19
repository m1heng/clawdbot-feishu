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
]);

export type FeishuChatParams = Static<typeof FeishuChatSchema>;
