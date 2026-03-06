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
    content: Type.Optional(Type.String({
      description: "Markdown content to write into the new document (optional, if provided will write content after creating)",
    })),
    folder_token: Type.Optional(Type.String({ description: "Target folder token (optional)" })),
    share_with: Type.Optional(
      Type.Object({
        member_type: Type.String({ description: "Member type: openid, email, userid, etc." }),
        member_id: Type.String({ description: "Member ID (e.g., user openid)" }),
        perm: Type.Union([Type.Literal("view"), Type.Literal("edit"), Type.Literal("full_access")], {
          description: "Permission level: view, edit, or full_access",
        }),
      })
    ),
  }),
  Type.Object({
    action: Type.Literal("create_with_content"),
    title: Type.String({ description: "Document title" }),
    content: Type.String({
      description: "Markdown content to write into the new document",
    }),
    folder_token: Type.Optional(Type.String({ description: "Target folder token (optional)" })),
    share_with: Type.Optional(
      Type.Object({
        member_type: Type.String({ description: "Member type: openid, email, userid, etc." }),
        member_id: Type.String({ description: "Member ID (e.g., user openid)" }),
        perm: Type.Union([Type.Literal("view"), Type.Literal("edit"), Type.Literal("full_access")], {
          description: "Permission level: view, edit, or full_access",
        }),
      })
    ),
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
]);

export type FeishuDocParams = Static<typeof FeishuDocSchema>;
