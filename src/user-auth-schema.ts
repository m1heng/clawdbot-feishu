import { Type, type Static } from "@sinclair/typebox";

export const FeishuUserAuthSchema = Type.Union([
  Type.Object({
    action: Type.Literal("authorize"),
    open_id: Type.String({
      description: "The user's open_id (from message context) to generate an OAuth authorization URL for",
    }),
  }),
  Type.Object({
    action: Type.Literal("status"),
    open_id: Type.String({
      description: "The user's open_id to check authorization status for",
    }),
  }),
  Type.Object({
    action: Type.Literal("revoke"),
    open_id: Type.String({
      description: "The user's open_id to revoke authorization for",
    }),
  }),
]);

export type FeishuUserAuthParams = Static<typeof FeishuUserAuthSchema>;
