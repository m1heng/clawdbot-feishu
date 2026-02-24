import { runChatApiCall, type ChatClient } from "./common.js";
import type { FeishuChatParams } from "./schemas.js";

type UserIdType = "open_id" | "user_id" | "union_id";
type MemberIdType = "open_id" | "user_id" | "union_id" | "app_id";

function omitUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as T;
}

async function createChat(
  client: ChatClient,
  params: Extract<FeishuChatParams, { action: "chat_create" }>,
) {
  const res = await runChatApiCall("im.v1.chat.create", () =>
    client.im.v1.chat.create({
      data: omitUndefined({
        name: params.name,
        description: params.description,
        owner_id: params.owner_id,
        user_id_list: params.user_id_list,
        bot_id_list: params.bot_id_list,
        group_message_type: params.group_message_type,
      }),
      params: omitUndefined({
        user_id_type: params.user_id_type as UserIdType | undefined,
        set_bot_manager: params.set_bot_manager,
        uuid: params.uuid,
      }),
    }),
  );

  return {
    chat: {
      chat_id: res.data?.chat_id,
      name: res.data?.name,
      description: res.data?.description,
      owner_id: res.data?.owner_id,
      owner_id_type: res.data?.owner_id_type,
      external: res.data?.external,
      add_member_permission: res.data?.add_member_permission,
      share_card_permission: res.data?.share_card_permission,
    },
  };
}

async function addChatMembers(
  client: ChatClient,
  params: Extract<FeishuChatParams, { action: "chat_add_members" }>,
) {
  const res = await runChatApiCall("im.v1.chatMembers.create", () =>
    client.im.v1.chatMembers.create({
      path: { chat_id: params.chat_id },
      data: { id_list: params.id_list },
      params: omitUndefined({
        member_id_type: params.member_id_type as MemberIdType | undefined,
        succeed_type: params.succeed_type,
      }),
    }),
  );

  return {
    success: true,
    chat_id: params.chat_id,
    invalid_id_list: res.data?.invalid_id_list ?? [],
    not_existed_id_list: res.data?.not_existed_id_list ?? [],
    pending_approval_id_list: res.data?.pending_approval_id_list ?? [],
  };
}

async function isInChat(
  client: ChatClient,
  params: Extract<FeishuChatParams, { action: "chat_is_in_chat" }>,
) {
  const res = await runChatApiCall("im.v1.chatMembers.isInChat", () =>
    client.im.v1.chatMembers.isInChat({
      path: { chat_id: params.chat_id },
    }),
  );

  return {
    chat_id: params.chat_id,
    is_in_chat: Boolean(res.data?.is_in_chat),
  };
}

export async function runChatAction(client: ChatClient, params: FeishuChatParams) {
  switch (params.action) {
    case "chat_create":
      return createChat(client, params);
    case "chat_add_members":
      return addChatMembers(client, params);
    case "chat_is_in_chat":
      return isInChat(client, params);
    default:
      return { error: `Unknown action: ${(params as { action?: string }).action ?? ""}` };
  }
}
