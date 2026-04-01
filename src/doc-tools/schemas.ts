import { Type, type Static } from "@sinclair/typebox";

function stringEnum<T extends readonly string[]>(
  values: T,
  options: { description?: string; default?: T[number] } = {},
) {
  return Type.Unsafe<T[number]>({ type: "string", enum: [...values], ...options });
}

const DOC_ACTION_VALUES = [
  "read",
  "write",
  "append",
  "create",
  "create_and_write",
  "list_blocks",
  "get_block",
  "update_block",
  "delete_block",
  "list_comments",
  "create_comment",
  "get_comment",
  "list_comment_replies",
  "create_diagram",
] as const;

export const FeishuDocSchema = Type.Object({
  action: stringEnum(DOC_ACTION_VALUES, { description: "Document action" }),
  doc_token: Type.Optional(
    Type.String({
      description:
        "Document token (extract from URL /docx/XXX or /docs/XXX). Supports both new (docx) and legacy (doc) formats.",
    }),
  ),
  content: Type.Optional(
    Type.String({
      description: "Markdown content for write/append/comment/update operations",
    }),
  ),
  title: Type.Optional(Type.String({ description: "Document title (for create/create_and_write)" })),
  folder_token: Type.Optional(Type.String({ description: "Target folder token (optional)" })),
  block_id: Type.Optional(Type.String({ description: "Block ID (from list_blocks)" })),
  comment_id: Type.Optional(Type.String({ description: "Comment ID" })),
  page_token: Type.Optional(Type.String({ description: "Page token for pagination" })),
  page_size: Type.Optional(
    Type.Integer({ minimum: 1, description: "Page size, default 50 (positive integer)" }),
  ),
});

export type FeishuDocParams = Static<typeof FeishuDocSchema>;
