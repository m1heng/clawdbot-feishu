import type { ChatClient } from "./common.js";
import type { FeishuChatParams } from "./schemas.js";
import { runChatApiCall } from "./common.js";

const BLOCK_TYPE_NAMES: Record<number, string> = {
  1: "Page",
  2: "Text",
  3: "Heading1",
  4: "Heading2",
  5: "Heading3",
  12: "Bullet",
  13: "Ordered",
  14: "Code",
  15: "Quote",
  17: "Todo",
  18: "Bitable",
  21: "Diagram",
  22: "Divider",
  23: "File",
  27: "Image",
  30: "Sheet",
  31: "Table",
  32: "TableCell",
};

const STRUCTURED_BLOCK_TYPES = new Set([14, 18, 21, 23, 27, 30, 31, 32]);

async function getAnnouncement(client: ChatClient, chatId: string) {
  try {
    const res = await runChatApiCall("im.chatAnnouncement.get", () =>
      (client as any).im.chatAnnouncement.get({
        path: { chat_id: chatId },
      }),
    );
    return {
      announcement_type: "doc" as const,
      ...(res as any).data,
    };
  } catch (err: any) {
    if (
      err?.response?.data?.code === 232097 ||
      err?.message?.includes("docx") ||
      err?.message?.includes("232097")
    ) {
      const infoRes = await runChatApiCall("docx.chatAnnouncement.get", () =>
        (client as any).docx.chatAnnouncement.get({
          path: { chat_id: chatId },
        }),
      );

      const blocksRes = await runChatApiCall("docx.chatAnnouncementBlock.list", () =>
        (client as any).docx.chatAnnouncementBlock.list({
          path: { chat_id: chatId },
        }),
      );

      const blocks = (blocksRes as any).data?.items ?? [];
      const blockCounts: Record<string, number> = {};
      const structuredTypes: string[] = [];

      for (const b of blocks) {
        const type = b.block_type ?? 0;
        const name = BLOCK_TYPE_NAMES[type] || `type_${type}`;
        blockCounts[name] = (blockCounts[name] || 0) + 1;

        if (STRUCTURED_BLOCK_TYPES.has(type) && !structuredTypes.includes(name)) {
          structuredTypes.push(name);
        }
      }

      let hint: string | undefined;
      if (structuredTypes.length > 0) {
        hint = `This announcement contains ${structuredTypes.join(", ")} which are NOT included in the basic info. Use action: "list_announcement_blocks" to get full content.`;
      }

      return {
        announcement_type: "docx" as const,
        info: (infoRes as any).data,
        blocks: blocks,
        block_count: blocks.length,
        block_types: blockCounts,
        ...(hint && { hint }),
      };
    }
    throw err;
  }
}

async function listAnnouncementBlocks(client: ChatClient, chatId: string) {
  const res = await runChatApiCall("docx.chatAnnouncementBlock.list", () =>
    (client as any).docx.chatAnnouncementBlock.list({
      path: { chat_id: chatId },
    }),
  );

  return {
    blocks: (res as any).data?.items ?? [],
  };
}

async function getAnnouncementBlock(client: ChatClient, chatId: string, blockId: string) {
  const res = await runChatApiCall("docx.chatAnnouncementBlock.get", () =>
    (client as any).docx.chatAnnouncementBlock.get({
      path: { chat_id: chatId, block_id: blockId },
    }),
  );

  return {
    block: (res as any).data?.block,
  };
}

async function writeDocAnnouncement(client: ChatClient, chatId: string, content: string) {
  const current = await runChatApiCall("im.chatAnnouncement.get", () =>
    (client as any).im.chatAnnouncement.get({
      path: { chat_id: chatId },
    }),
  );

  const res = await runChatApiCall("im.chatAnnouncement.patch", () =>
    (client as any).im.chatAnnouncement.patch({
      path: { chat_id: chatId },
      data: {
        content,
        revision: (current as any).data?.revision,
      },
    }),
  );

  return {
    success: true,
    announcement_type: "doc",
    ...(res as any).data,
  };
}

async function createAnnouncementBlockChild(
  client: ChatClient,
  chatId: string,
  parentBlockId: string,
  blockData: any,
) {
  const res = await runChatApiCall("docx.chatAnnouncementBlockChildren.create", () =>
    (client as any).docx.chatAnnouncementBlockChildren.create({
      path: { chat_id: chatId, block_id: parentBlockId },
      data: blockData,
    }),
  );

  return {
    success: true,
    block: (res as any).data,
  };
}

async function createTextBlock(
  client: ChatClient,
  chatId: string,
  parentBlockId: string,
  text: string,
) {
  const blockData = {
    children: [
      {
        block_type: 2,
        text: {
          elements: [
            {
              text_run: {
                content: text,
              },
            },
          ],
        },
      },
    ],
  };

  return createAnnouncementBlockChild(client, chatId, parentBlockId, blockData);
}

async function batchUpdateAnnouncementBlocks(
  client: ChatClient,
  chatId: string,
  requests: any[],
) {
  const info = await runChatApiCall("docx.chatAnnouncement.get", () =>
    (client as any).docx.chatAnnouncement.get({
      path: { chat_id: chatId },
    }),
  );

  const res = await runChatApiCall("docx.chatAnnouncementBlock.batchUpdate", () =>
    (client as any).docx.chatAnnouncementBlock.batchUpdate({
      path: { chat_id: chatId },
      data: {
        revision_id: (info as any).data?.revision_id,
        requests,
      },
    }),
  );

  return {
    success: true,
    ...(res as any).data,
  };
}

// ============== New Chat Management Functions ==============

async function createChat(client: ChatClient, name: string, userIds?: string[], description?: string) {
  const data: any = { name };
  if (userIds && userIds.length > 0) {
    data.user_id_list = userIds;
  }
  if (description) {
    data.description = description;
  }

  const res = await runChatApiCall("im.chat.create", () =>
    (client as any).im.chat.create({ data }),
  );

  return {
    success: true,
    chat_id: (res as any).data?.chat_id,
    ...(res as any).data,
  };
}

async function addMembers(client: ChatClient, chatId: string, userIds: string[]) {
  const res = await runChatApiCall("im.chat.member.add", () =>
    (client as any).im.chat.member.add({
      path: { chat_id: chatId },
      data: { id_list: userIds },
    }),
  );

  return {
    success: true,
    chat_id: chatId,
    added_user_ids: userIds,
    ...(res as any).data,
  };
}

async function checkBotInChat(client: ChatClient, chatId: string) {
  try {
    const res = await runChatApiCall("im.chat.get", () =>
      (client as any).im.chat.get({ path: { chat_id: chatId } }),
    );
    
    return {
      success: true,
      chat_id: chatId,
      in_chat: true,
      chat_info: (res as any).data,
    };
  } catch (err: any) {
    if (err?.response?.data?.code === 90003) {
      return {
        success: true,
        chat_id: chatId,
        in_chat: false,
        error: "Bot is not in this chat",
      };
    }
    throw err;
  }
}

async function sendMessage(client: ChatClient, chatId: string, content: string) {
  const res = await runChatApiCall("im.message.create", () =>
    (client as any).im.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text: content }),
      },
    }),
  );

  return {
    success: true,
    message_id: (res as any).data?.message_id,
    ...(res as any).data,
  };
}

async function createSessionChat(
  client: ChatClient,
  name: string,
  userIds: string[],
  greeting?: string,
  description?: string,
) {
  // Step 1: Create the chat
  const createResult = await createChat(client, name, userIds, description);
  const chatId = createResult.chat_id;
  
  if (!chatId) {
    return {
      success: false,
      error: "Failed to create chat - no chat_id returned",
      create_result: createResult,
    };
  }

  // Step 2: Send greeting message
  const defaultGreeting = "Hello! I've created this group chat for us to collaborate.";
  const greetingMessage = greeting || defaultGreeting;
  
  let messageResult;
  try {
    messageResult = await sendMessage(client, chatId, greetingMessage);
  } catch (err: any) {
    // Even if message fails, the chat was created successfully
    return {
      success: true,
      chat_id: chatId,
      create_result: createResult,
      message_error: err?.message || "Failed to send greeting message",
    };
  }

  return {
    success: true,
    chat_id: chatId,
    create_result: createResult,
    message_result: messageResult,
  };
}

async function deleteChat(client: ChatClient, chatId: string) {
  const res = await runChatApiCall("im.chat.disband", () =>
    (client as any).im.chat.disband({
      path: { chat_id: chatId },
    }),
  );

  return {
    success: true,
    chat_id: chatId,
    message: "Chat has been successfully disbanded/deleted",
    ...(res as any).data,
  };
}

// Main action handler - MUST BE EXPORTED
export async function runChatAction(client: ChatClient, params: FeishuChatParams) {
  switch (params.action) {
    case "get_announcement_info":
    case "get_announcement":
      return getAnnouncement(client, params.chat_id);
    case "list_announcement_blocks":
      return listAnnouncementBlocks(client, params.chat_id);
    case "get_announcement_block":
      return getAnnouncementBlock(client, params.chat_id, params.block_id);
    case "write_announcement": {
      const current = await getAnnouncement(client, params.chat_id);
      if (current.announcement_type === "doc") {
        return writeDocAnnouncement(client, params.chat_id, params.content);
      } else {
        return {
          error: "write_announcement for docx format requires block-level operations.",
        };
      }
    }
    case "append_announcement": {
      try {
        const current = await getAnnouncement(client, params.chat_id);
        if (current.announcement_type === "doc") {
          const existingContent = (current as any).content || "";
          const newContent = existingContent + "\n" + params.content;
          return writeDocAnnouncement(client, params.chat_id, newContent);
        } else {
          const parentBlockId = params.chat_id;
          return createTextBlock(client, params.chat_id, parentBlockId, params.content);
        }
      } catch (err: any) {
        const parentBlockId = params.chat_id;
        return createTextBlock(client, params.chat_id, parentBlockId, params.content);
      }
    }
    case "update_announcement_block": {
      const requests = [
        {
          block_id: params.block_id,
          operation: "update",
          update_text_elements: {
            elements: [{ text_run: { content: params.content } }],
          },
        },
      ];
      return batchUpdateAnnouncementBlocks(client, params.chat_id, requests);
    }
    case "delete_announcement_block": {
      return {
        error: "delete_announcement_block requires parent block ID and child indices. Use list_announcement_blocks to view the structure first.",
      };
    }
    // ============== New Chat Management Actions ==============
    case "create_chat": {
      return createChat(client, params.name, params.user_ids, params.description);
    }
    case "add_members": {
      return addMembers(client, params.chat_id, params.user_ids);
    }
    case "check_bot_in_chat": {
      return checkBotInChat(client, params.chat_id);
    }
    case "delete_chat": {
      return deleteChat(client, params.chat_id);
    }
    case "create_session_chat": {
      return createSessionChat(
        client,
        params.name,
        params.user_ids,
        params.greeting,
        params.description,
      );
    }
    default:
      return { error: `Unknown action: ${(params as any).action}` };
  }
}
