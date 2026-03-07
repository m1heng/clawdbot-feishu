import { Type, type Static } from "@sinclair/typebox";

function stringEnum<T extends readonly string[]>(
  values: T,
  options: { description?: string; default?: T[number] } = {},
) {
  return Type.Unsafe<T[number]>({ type: "string", enum: [...values], ...options });
}

const TOKEN_TYPE_VALUES = [
  "doc",
  "docx",
  "sheet",
  "bitable",
  "folder",
  "file",
  "wiki",
  "mindnote",
] as const;

const MEMBER_TYPE_VALUES = [
  "email",
  "openid",
  "userid",
  "unionid",
  "openchat",
  "opendepartmentid",
] as const;

const PERMISSION_VALUES = ["view", "edit", "full_access"] as const;
const PERM_ACTION_VALUES = ["list", "add", "remove"] as const;

export const FeishuPermSchema = Type.Object({
  action: stringEnum(PERM_ACTION_VALUES, { description: "Permission action" }),
  token: Type.Optional(Type.String({ description: "File token" })),
  type: Type.Optional(stringEnum(TOKEN_TYPE_VALUES, { description: "File token type" })),
  member_type: Type.Optional(
    stringEnum(MEMBER_TYPE_VALUES, {
      description: "Member ID type (email/openid/userid/unionid/openchat/opendepartmentid)",
    }),
  ),
  member_id: Type.Optional(Type.String({ description: "Member ID" })),
  perm: Type.Optional(stringEnum(PERMISSION_VALUES, { description: "Permission level" })),
});

export type FeishuPermParams = Static<typeof FeishuPermSchema>;
