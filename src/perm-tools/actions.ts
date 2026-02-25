import { runPermApiCall, type PermClient } from "./common.js";
import type { FeishuPermParams } from "./schemas.js";

type ListTokenType =
  | "doc"
  | "sheet"
  | "file"
  | "wiki"
  | "bitable"
  | "docx"
  | "mindnote"
  | "minutes"
  | "slides";
type CreateTokenType =
  | "doc"
  | "sheet"
  | "file"
  | "wiki"
  | "bitable"
  | "docx"
  | "folder"
  | "mindnote"
  | "minutes"
  | "slides";
type MemberType =
  | "email"
  | "openid"
  | "unionid"
  | "openchat"
  | "opendepartmentid"
  | "userid"
  | "groupid"
  | "wikispaceid";
type PermType = "view" | "edit" | "full_access";

async function listMembers(client: PermClient, token: string, type: string) {
  const res = await runPermApiCall("drive.permissionMember.list", () =>
    client.drive.permissionMember.list({
      path: { token },
      params: { type: type as ListTokenType },
    }),
  );

  return {
    members:
      res.data?.items?.map((m) => ({
        member_type: m.member_type,
        member_id: m.member_id,
        perm: m.perm,
        name: m.name,
      })) ?? [],
  };
}

async function addMember(
  client: PermClient,
  token: string,
  type: string,
  memberType: string,
  memberId: string,
  perm: string,
) {
  const res = await runPermApiCall("drive.permissionMember.create", () =>
    client.drive.permissionMember.create({
      path: { token },
      params: { type: type as CreateTokenType, need_notification: false },
      data: {
        member_type: memberType as MemberType,
        member_id: memberId,
        perm: perm as PermType,
      },
    }),
  );

  return {
    success: true,
    member: res.data?.member,
  };
}

async function removeMember(
  client: PermClient,
  token: string,
  type: string,
  memberType: string,
  memberId: string,
) {
  await runPermApiCall("drive.permissionMember.delete", () =>
    client.drive.permissionMember.delete({
      path: { token, member_id: memberId },
      params: { type: type as CreateTokenType, member_type: memberType as MemberType },
    }),
  );

  return {
    success: true,
  };
}

export async function runPermAction(client: PermClient, params: FeishuPermParams) {
  switch (params.action) {
    case "list":
      return listMembers(client, params.token, params.type);
    case "add":
      return addMember(client, params.token, params.type, params.member_type, params.member_id, params.perm);
    case "remove":
      return removeMember(client, params.token, params.type, params.member_type, params.member_id);
    default:
      return { error: `Unknown action: ${(params as any).action}` };
  }
}
