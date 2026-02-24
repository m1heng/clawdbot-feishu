import { runChatApiCall, type ChatClient } from "./common.js";
import type { FeishuChatParams } from "./schemas.js";
import type { MemberIdType, UserIdType } from "./constants.js";

function omitUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as T;
}

async function createChat(
  client: ChatClient,
  params: Extract<FeishuChatParams, { action: "group_chat_create" }>,
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
  params: Extract<FeishuChatParams, { action: "group_chat_add_members" }>,
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
    chat_id: params.chat_id,
    invalid_id_list: res.data?.invalid_id_list ?? [],
    not_existed_id_list: res.data?.not_existed_id_list ?? [],
    pending_approval_id_list: res.data?.pending_approval_id_list ?? [],
  };
}

async function isInChat(
  client: ChatClient,
  params: Extract<FeishuChatParams, { action: "group_chat_is_in_chat" }>,
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

async function createChatSession(
  client: ChatClient,
  params: Extract<FeishuChatParams, { action: "group_chat_create_session" }>,
) {
  const createRes = await runChatApiCall("im.v1.chat.create", () =>
    client.im.v1.chat.create({
      data: omitUndefined({
        name: params.name,
        description: params.description,
        owner_id: params.owner_id,
        user_id_list: [params.participant_id],
        group_message_type: params.group_message_type,
      }),
      params: omitUndefined({
        user_id_type: params.participant_id_type as UserIdType | undefined,
        set_bot_manager: params.set_bot_manager,
        uuid: params.uuid,
      }),
    }),
  );

  const chatId = createRes.data?.chat_id;
  if (!chatId) {
    throw new Error("group chat created without chat_id");
  }

  const greeting = params.greeting?.trim() || "你好，我是番薯仔 🐶，这个群已经创建好啦，我们可以在这里继续聊。";

  const content = JSON.stringify({ text: greeting });
  const messageRes = await runChatApiCall("im.v1.message.create", () =>
    client.im.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: chatId,
        msg_type: "text",
        content,
      },
    }),
  );

  return {
    chat: {
      chat_id: chatId,
      name: createRes.data?.name,
      description: createRes.data?.description,
      owner_id: createRes.data?.owner_id,
      owner_id_type: createRes.data?.owner_id_type,
      external: createRes.data?.external,
    },
    session: {
      participant_id: params.participant_id,
      participant_id_type: params.participant_id_type ?? "open_id",
      greeting_sent: true,
      greeting_message_id: messageRes.data?.message_id,
    },
  };
}

export async function runChatAction(client: ChatClient, params: FeishuChatParams) {
  switch (params.action) {
    case "group_chat_create":
      return createChat(client, params);
    case "group_chat_create_session":
      return createChatSession(client, params);
    case "group_chat_add_members":
      return addChatMembers(client, params);
    case "group_chat_is_in_chat":
      return isInChat(client, params);
    default:
      return { error: `Unknown action: ${(params as { action?: string }).action ?? ""}` };
  }
}
