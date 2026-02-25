import { Type } from "@sinclair/typebox";

export const USER_ID_TYPES = ["open_id", "user_id", "union_id"] as const;
export type UserIdType = (typeof USER_ID_TYPES)[number];

export const MEMBER_ID_TYPES = ["open_id", "user_id", "union_id", "app_id"] as const;
export type MemberIdType = (typeof MEMBER_ID_TYPES)[number];

export const UserIdTypeSchema = Type.Union(USER_ID_TYPES.map((value) => Type.Literal(value)));
export const MemberIdTypeSchema = Type.Union(MEMBER_ID_TYPES.map((value) => Type.Literal(value)));
