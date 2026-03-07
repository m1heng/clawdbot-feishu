import { Type, type Static } from "@sinclair/typebox";

function stringEnum<T extends readonly string[]>(
  values: T,
  options: { description?: string; default?: T[number] } = {},
) {
  return Type.Unsafe<T[number]>({ type: "string", enum: [...values], ...options });
}

const FILE_TYPE_VALUES = [
  "doc",
  "docx",
  "sheet",
  "bitable",
  "folder",
  "file",
  "mindnote",
  "shortcut",
] as const;

const DOC_TYPE_VALUES = ["docx", "doc"] as const;

const DRIVE_ACTION_VALUES = [
  "list",
  "info",
  "create_folder",
  "move",
  "delete",
  "import_document",
] as const;

export const FeishuDriveSchema = Type.Object({
  action: stringEnum(DRIVE_ACTION_VALUES, { description: "Drive action" }),
  folder_token: Type.Optional(
    Type.String({ description: "Folder token (optional, omit for root directory)" }),
  ),
  file_token: Type.Optional(Type.String({ description: "File or folder token" })),
  type: Type.Optional(stringEnum(FILE_TYPE_VALUES, { description: "File type" })),
  name: Type.Optional(Type.String({ description: "Folder name (for create_folder)" })),
  title: Type.Optional(Type.String({ description: "Document title (for import_document)" })),
  content: Type.Optional(
    Type.String({
      description:
        "Markdown content to import. Supports full Markdown syntax including tables, lists, code blocks, etc.",
    }),
  ),
  doc_type: Type.Optional(
    stringEnum(DOC_TYPE_VALUES, {
      description: "Document type for import_document (docx default, doc legacy)",
    }),
  ),
});

export type FeishuDriveParams = Static<typeof FeishuDriveSchema>;
