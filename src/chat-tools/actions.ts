import type { ChatClient } from "./common.js";
import type { FeishuChatParams } from "./schemas.js";
import { runChatApiCall } from "./common.js";

type UserIdType = "open_id" | "user_id" | "union_id";
type MemberIdType = UserIdType | "app_id";

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
  return value;
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string")) {
    throw new Error(`${field} must be a non-empty string array`);
  }
  return value;
}

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
  // Use docx.chatAnnouncement.get first — it works for both doc and docx announcements
  // and returns announcement_type in its response, avoiding the noisy 232097 error
  // that would occur when calling the legacy im API on a docx announcement.
  const infoRes = await runChatApiCall("docx.chatAnnouncement.get", () =>
    (client as any).docx.chatAnnouncement.get({
      path: { chat_id: chatId },
    }),
  );

  const announcementType = (infoRes as any).data?.announcement_type;

  if (announcementType === "doc") {
    // Legacy doc format: fetch actual content via the im API
    const docRes = await runChatApiCall("im.chatAnnouncement.get", () =>
      (client as any).im.chatAnnouncement.get({
        path: { chat_id: chatId },
      }),
    );
    return {
      announcement_type: "doc" as const,
      ...(docRes as any).data,
    };
  }

  // docx format (or unrecognised new format): fetch blocks
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
    blocks,
    block_count: blocks.length,
    block_types: blockCounts,
    ...(hint && { hint }),
  };
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

  const revision = (current as any).data?.revision;
  if (!revision) {
    throw new Error("Failed to load current announcement revision");
  }

  let res: unknown;
  try {
    // Prefer SDK current payload shape (revision + requests[]).
    res = await runChatApiCall("im.chatAnnouncement.patch", () =>
      (client as any).im.chatAnnouncement.patch({
        path: { chat_id: chatId },
        data: {
          revision,
          requests: [content],
        },
      }),
    );
  } catch {
    // Backward compatibility for tenants still accepting legacy content payload.
    res = await runChatApiCall("im.chatAnnouncement.patch", () =>
      (client as any).im.chatAnnouncement.patch({
        path: { chat_id: chatId },
        data: {
          content,
          revision,
        },
      }),
    );
  }

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
      params: {
        revision_id: (info as any).data?.revision_id,
      },
      data: {
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

async function createChat(
  client: ChatClient,
  name: string,
  userIds?: string[],
  description?: string,
  userIdType: UserIdType = "open_id",
) {
  const data: any = { name };
  if (userIds && userIds.length > 0) {
    data.user_id_list = userIds;
  }
  if (description) {
    data.description = description;
  }

  const res = await runChatApiCall("im.chat.create", () =>
    (client as any).im.chat.create({
      data,
      params: { user_id_type: userIdType },
    }),
  );

  return {
    success: true,
    chat_id: (res as any).data?.chat_id,
    ...(res as any).data,
  };
}

async function addMembers(
  client: ChatClient,
  chatId: string,
  userIds: string[],
  memberIdType: MemberIdType = "open_id",
) {
  const res = await runChatApiCall("im.chatMembers.create", () =>
    (client as any).im.chatMembers.create({
      path: { chat_id: chatId },
      params: { member_id_type: memberIdType },
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
    if (err?.message?.includes("90003")) {
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
  userIdType: UserIdType = "open_id",
) {
  // Step 1: Create the chat
  const createResult = await createChat(client, name, userIds, description, userIdType);
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
  const res = await runChatApiCall("im.chat.delete", () =>
    (client as any).im.chat.delete({
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
      return getAnnouncement(client, requireString(params.chat_id, "chat_id"));
    case "list_announcement_blocks":
      return listAnnouncementBlocks(client, requireString(params.chat_id, "chat_id"));
    case "get_announcement_block":
      return getAnnouncementBlock(
        client,
        requireString(params.chat_id, "chat_id"),
        requireString(params.block_id, "block_id"),
      );
    case "write_announcement": {
      const chatId = requireString(params.chat_id, "chat_id");
      const content = requireString(params.content, "content");
      const current = await getAnnouncement(client, chatId);
      if (current.announcement_type === "doc") {
        return writeDocAnnouncement(client, chatId, content);
      } else {
        // For docx announcements, append a text block under the Page root block.
        // Full replacement is not supported via API; use update_announcement_block to edit existing blocks.
        const blocks: any[] = (current as any).blocks ?? [];
        const pageBlock = blocks.find((b: any) => b.block_type === 1);
        if (!pageBlock?.block_id) {
          return { error: "Could not find the Page root block for docx announcement. Use list_announcement_blocks to inspect the structure." };
        }
        return createTextBlock(client, chatId, pageBlock.block_id, content);
      }
    }
    case "append_announcement": {
      const chatId = requireString(params.chat_id, "chat_id");
      const content = requireString(params.content, "content");
      const current = await getAnnouncement(client, chatId);
      if (current.announcement_type === "doc") {
        const existingContent = (current as any).content || "";
        const newContent = existingContent + "\n" + content;
        return writeDocAnnouncement(client, chatId, newContent);
      } else {
        // For docx format, the parent block must be the Page root block (block_type: 1)
        const blocks: any[] = (current as any).blocks ?? [];
        const pageBlock = blocks.find((b: any) => b.block_type === 1);
        if (!pageBlock?.block_id) {
          return { error: "Could not find the Page root block for docx announcement. Use list_announcement_blocks to inspect the structure." };
        }
        return createTextBlock(client, chatId, pageBlock.block_id, content);
      }
    }
    case "update_announcement_block": {
      const requests = [
        {
          block_id: requireString(params.block_id, "block_id"),
          update_text_elements: {
            elements: [{ text_run: { content: requireString(params.content, "content") } }],
          },
        },
      ];
      return batchUpdateAnnouncementBlocks(client, requireString(params.chat_id, "chat_id"), requests);
    }
    // ============== New Chat Management Actions ==============
    case "create_chat": {
      return createChat(
        client,
        requireString(params.name, "name"),
        params.user_ids,
        params.description,
        params.user_id_type,
      );
    }
    case "add_members": {
      return addMembers(
        client,
        requireString(params.chat_id, "chat_id"),
        requireStringArray(params.user_ids, "user_ids"),
        params.member_id_type,
      );
    }
    case "check_bot_in_chat": {
      return checkBotInChat(client, requireString(params.chat_id, "chat_id"));
    }
    case "delete_chat": {
      return deleteChat(client, requireString(params.chat_id, "chat_id"));
    }
    case "create_session_chat": {
      return createSessionChat(
        client,
        requireString(params.name, "name"),
        requireStringArray(params.user_ids, "user_ids"),
        params.greeting,
        params.description,
        params.user_id_type,
      );
    }
    default:
      return { error: `Unknown action: ${(params as any).action}` };
  }
}
