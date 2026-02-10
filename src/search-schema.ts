import { Type, type Static } from "@sinclair/typebox";

export const FeishuSearchSchema = Type.Object({
  action: Type.Literal("search"),
  open_id: Type.String({
    description: "The user's open_id (from message context) to look up user token for search API",
  }),
  keyword: Type.String({
    description: "Search keyword",
  }),
  type: Type.Optional(
    Type.Union(
      [
        Type.Literal("document"),
        Type.Literal("doc"),
        Type.Literal("wiki"),
        Type.Literal("all"),
      ],
      {
        description:
          "Search type: document/doc (documents only), wiki (knowledge base only), all (both). Default: all",
      },
    ),
  ),
  count: Type.Optional(
    Type.Number({
      description: "Maximum number of results (default: 20, max: 50)",
      minimum: 1,
      maximum: 50,
    }),
  ),
});

export type FeishuSearchParams = Static<typeof FeishuSearchSchema>;
