import { Type, type Static } from "@sinclair/typebox";

function stringEnum<T extends readonly string[]>(
  values: T,
  options: { description?: string; default?: T[number] } = {},
) {
  return Type.Unsafe<T[number]>({ type: "string", enum: [...values], ...options });
}

const WIKI_ACTION_VALUES = ["spaces", "nodes", "get", "search", "create", "move", "rename"] as const;
const WIKI_OBJ_TYPE_VALUES = ["docx", "sheet", "bitable"] as const;

export const FeishuWikiSchema = Type.Object({
  action: stringEnum(WIKI_ACTION_VALUES, { description: "Wiki action" }),
  space_id: Type.Optional(Type.String({ description: "Knowledge space ID" })),
  parent_node_token: Type.Optional(
    Type.String({ description: "Parent node token (optional, omit for root)" }),
  ),
  token: Type.Optional(Type.String({ description: "Wiki node token (from URL /wiki/XXX)" })),
  query: Type.Optional(Type.String({ description: "Search query" })),
  title: Type.Optional(Type.String({ description: "Node title / new title" })),
  obj_type: Type.Optional(
    stringEnum(WIKI_OBJ_TYPE_VALUES, {
      description: "Object type for create action (default: docx)",
    }),
  ),
  node_token: Type.Optional(Type.String({ description: "Node token" })),
  target_space_id: Type.Optional(
    Type.String({ description: "Target space ID (optional, same space if omitted)" }),
  ),
  target_parent_token: Type.Optional(
    Type.String({ description: "Target parent node token (optional, root if omitted)" }),
  ),
});

export type FeishuWikiParams = Static<typeof FeishuWikiSchema>;
