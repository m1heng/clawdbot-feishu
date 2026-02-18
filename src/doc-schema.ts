import { Type, type Static } from "@sinclair/typebox";

export const FeishuDocSchema = Type.Union([
  Type.Object({
    action: Type.Literal("read"),
    doc_token: Type.String({ description: "Document token (extract from URL /docx/XXX)" }),
  }),
  Type.Object({
    action: Type.Literal("write"),
    doc_token: Type.String({ description: "Document token" }),
    content: Type.String({
      description: "Markdown content to write (replaces entire document content)",
    }),
  }),
  Type.Object({
    action: Type.Literal("append"),
    doc_token: Type.String({ description: "Document token" }),
    content: Type.String({ description: "Markdown content to append to end of document" }),
  }),
  Type.Object({
    action: Type.Literal("create"),
    title: Type.String({ description: "Document title" }),
    folder_token: Type.Optional(Type.String({ description: "Target folder token (optional)" })),
  }),
  Type.Object({
    action: Type.Literal("create_and_write"),
    title: Type.String({ description: "Document title" }),
    content: Type.String({
      description: "Markdown content to write immediately after document creation",
    }),
    folder_token: Type.Optional(Type.String({ description: "Target folder token (optional)" })),
  }),
  Type.Object({
    action: Type.Literal("list_blocks"),
    doc_token: Type.String({ description: "Document token" }),
  }),
  Type.Object({
    action: Type.Literal("get_block"),
    doc_token: Type.String({ description: "Document token" }),
    block_id: Type.String({ description: "Block ID (from list_blocks)" }),
  }),
  Type.Object({
    action: Type.Literal("update_block"),
    doc_token: Type.String({ description: "Document token" }),
    block_id: Type.String({ description: "Block ID (from list_blocks)" }),
    content: Type.String({ description: "New text content" }),
  }),
  Type.Object({
    action: Type.Literal("delete_block"),
    doc_token: Type.String({ description: "Document token" }),
    block_id: Type.String({ description: "Block ID" }),
  }),
  Type.Object({
    action: Type.Literal("list_comments"),
    doc_token: Type.String({ description: "Document token" }),
    page_token: Type.Optional(Type.String({ description: "Page token for pagination" })),
    page_size: Type.Optional(
      Type.Integer({ minimum: 1, description: "Page size, default 50 (positive integer)" }),
    ),
  }),
  Type.Object({
    action: Type.Literal("create_comment"),
    doc_token: Type.String({ description: "Document token" }),
    content: Type.String({ description: "Comment content" }),
  }),
  Type.Object({
    action: Type.Literal("get_comment"),
    doc_token: Type.String({ description: "Document token" }),
    comment_id: Type.String({ description: "Comment ID" }),
  }),
  Type.Object({
    action: Type.Literal("list_comment_replies"),
    doc_token: Type.String({ description: "Document token" }),
    comment_id: Type.String({ description: "Comment ID" }),
    page_token: Type.Optional(Type.String({ description: "Page token for pagination" })),
    page_size: Type.Optional(
      Type.Integer({ minimum: 1, description: "Page size, default 50 (positive integer)" }),
    ),
  }),
]);

export type FeishuDocParams = Static<typeof FeishuDocSchema>;
