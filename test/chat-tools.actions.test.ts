import test from "node:test";
import assert from "node:assert/strict";
import { runChatAction } from "../src/chat-tools/actions.js";

test("runChatAction create calls chat.create with mapped payload", async () => {
  let captured: unknown;
  const client = {
    im: {
      v1: {
        chat: {
          create: async (payload: unknown) => {
            captured = payload;
            return {
              code: 0,
              data: {
                chat_id: "oc_123",
                name: "Dev Group",
                description: "for testing",
                owner_id: "ou_owner",
                owner_id_type: "open_id",
                external: false,
                add_member_permission: "all_members",
                share_card_permission: "allowed",
              },
            };
          },
        },
      },
    },
  } as any;

  const result = await runChatAction(client, {
    action: "group_chat_create",
    name: "Dev Group",
    description: "for testing",
    owner_id: "ou_owner",
    user_id_type: "open_id",
    user_id_list: ["ou_a"],
    bot_id_list: ["cli_bot"],
    set_bot_manager: true,
    group_message_type: "chat",
    uuid: "idempotent-key",
  });

  assert.deepEqual(captured, {
    data: {
      name: "Dev Group",
      description: "for testing",
      owner_id: "ou_owner",
      user_id_list: ["ou_a"],
      bot_id_list: ["cli_bot"],
      group_message_type: "chat",
    },
    params: {
      user_id_type: "open_id",
      set_bot_manager: true,
      uuid: "idempotent-key",
    },
  });

  assert.deepEqual(result, {
    chat: {
      chat_id: "oc_123",
      name: "Dev Group",
      description: "for testing",
      owner_id: "ou_owner",
      owner_id_type: "open_id",
      external: false,
      add_member_permission: "all_members",
      share_card_permission: "allowed",
    },
  });
});

test("runChatAction create_session creates group with participant and sends greeting", async () => {
  let createPayload: unknown;
  let messagePayload: unknown;
  const client = {
    im: {
      v1: {
        chat: {
          create: async (payload: unknown) => {
            createPayload = payload;
            return {
              code: 0,
              data: {
                chat_id: "oc_session",
                name: "Session Group",
                description: "session desc",
                owner_id: "ou_owner",
                owner_id_type: "open_id",
                external: false,
              },
            };
          },
        },
      },
      message: {
        create: async (payload: unknown) => {
          messagePayload = payload;
          return { code: 0, data: { message_id: "om_greeting" } };
        },
      },
    },
  } as any;

  const result = await runChatAction(client, {
    action: "group_chat_create_session",
    name: "Session Group",
    participant_id: "ou_target",
    participant_id_type: "open_id",
    description: "session desc",
    greeting: "hello there",
    group_message_type: "chat",
    owner_id: "ou_owner",
    set_bot_manager: true,
    uuid: "session-idempotent-key",
  });

  assert.deepEqual(createPayload, {
    data: {
      name: "Session Group",
      description: "session desc",
      owner_id: "ou_owner",
      user_id_list: ["ou_target"],
      group_message_type: "chat",
    },
    params: {
      user_id_type: "open_id",
      set_bot_manager: true,
      uuid: "session-idempotent-key",
    },
  });

  assert.deepEqual(messagePayload, {
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: "oc_session",
      msg_type: "text",
      content: JSON.stringify({ text: "hello there" }),
    },
  });

  assert.deepEqual(result, {
    chat: {
      chat_id: "oc_session",
      name: "Session Group",
      description: "session desc",
      owner_id: "ou_owner",
      owner_id_type: "open_id",
      external: false,
    },
    session: {
      participant_id: "ou_target",
      participant_id_type: "open_id",
      greeting_sent: true,
      greeting_message_id: "om_greeting",
    },
  });
});

test("runChatAction add_members calls chatMembers.create and normalizes lists", async () => {
  let captured: unknown;
  const client = {
    im: {
      v1: {
        chatMembers: {
          create: async (payload: unknown) => {
            captured = payload;
            return {
              code: 0,
              data: {
                invalid_id_list: ["bad_1"],
                not_existed_id_list: ["missing_1"],
                pending_approval_id_list: ["pending_1"],
              },
            };
          },
        },
      },
    },
  } as any;

  const result = await runChatAction(client, {
    action: "group_chat_add_members",
    chat_id: "oc_group",
    id_list: ["cli_bot"],
    member_id_type: "app_id",
    succeed_type: 1,
  });

  assert.deepEqual(captured, {
    path: { chat_id: "oc_group" },
    data: { id_list: ["cli_bot"] },
    params: { member_id_type: "app_id", succeed_type: 1 },
  });

  assert.deepEqual(result, {
    chat_id: "oc_group",
    invalid_id_list: ["bad_1"],
    not_existed_id_list: ["missing_1"],
    pending_approval_id_list: ["pending_1"],
  });
});

test("runChatAction is_in_chat returns boolean from API response", async () => {
  const client = {
    im: {
      v1: {
        chatMembers: {
          isInChat: async () => ({ code: 0, data: { is_in_chat: true } }),
        },
      },
    },
  } as any;

  const result = await runChatAction(client, {
    action: "group_chat_is_in_chat",
    chat_id: "oc_group",
  });

  assert.deepEqual(result, {
    chat_id: "oc_group",
    is_in_chat: true,
  });
});
