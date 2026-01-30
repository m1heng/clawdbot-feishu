import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import type { FeishuConfig, FeishuSendResult, FeishuHistoryMessage, ListMessagesResult } from "./types.js";
import { createFeishuClient } from "./client.js";
import { resolveReceiveIdType, normalizeFeishuTarget } from "./targets.js";
import { getFeishuRuntime } from "./runtime.js";

export type FeishuMessageInfo = {
  messageId: string;
  chatId: string;
  senderId?: string;
  senderOpenId?: string;
  content: string;
  contentType: string;
  createTime?: number;
};

/**
 * Get a message by its ID.
 * Useful for fetching quoted/replied message content.
 */
export async function getMessageFeishu(params: {
  cfg: ClawdbotConfig;
  messageId: string;
}): Promise<FeishuMessageInfo | null> {
  const { cfg, messageId } = params;
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg) {
    throw new Error("Feishu channel not configured");
  }

  const client = createFeishuClient(feishuCfg);

  try {
    const response = (await client.im.message.get({
      path: { message_id: messageId },
    })) as {
      code?: number;
      msg?: string;
      data?: {
        items?: Array<{
          message_id?: string;
          chat_id?: string;
          msg_type?: string;
          body?: { content?: string };
          sender?: {
            id?: string;
            id_type?: string;
            sender_type?: string;
          };
          create_time?: string;
        }>;
      };
    };

    if (response.code !== 0) {
      return null;
    }

    const item = response.data?.items?.[0];
    if (!item) {
      return null;
    }

    // Parse content based on message type
    let content = item.body?.content ?? "";
    try {
      const parsed = JSON.parse(content);
      if (item.msg_type === "text" && parsed.text) {
        content = parsed.text;
      }
    } catch {
      // Keep raw content if parsing fails
    }

    return {
      messageId: item.message_id ?? messageId,
      chatId: item.chat_id ?? "",
      senderId: item.sender?.id,
      senderOpenId: item.sender?.id_type === "open_id" ? item.sender?.id : undefined,
      content,
      contentType: item.msg_type ?? "text",
      createTime: item.create_time ? parseInt(item.create_time, 10) : undefined,
    };
  } catch {
    return null;
  }
}

export type SendFeishuMessageParams = {
  cfg: ClawdbotConfig;
  to: string;
  text: string;
  replyToMessageId?: string;
};

export async function sendMessageFeishu(params: SendFeishuMessageParams): Promise<FeishuSendResult> {
  const { cfg, to, text, replyToMessageId } = params;
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg) {
    throw new Error("Feishu channel not configured");
  }

  const client = createFeishuClient(feishuCfg);
  const receiveId = normalizeFeishuTarget(to);
  if (!receiveId) {
    throw new Error(`Invalid Feishu target: ${to}`);
  }

  const receiveIdType = resolveReceiveIdType(receiveId);
  const tableMode = getFeishuRuntime().channel.text.resolveMarkdownTableMode({
    cfg,
    channel: "feishu",
  });
  const messageText = getFeishuRuntime().channel.text.convertMarkdownTables(text ?? "", tableMode);

  const content = JSON.stringify({ text: messageText });

  if (replyToMessageId) {
    const response = await client.im.message.reply({
      path: { message_id: replyToMessageId },
      data: {
        content,
        msg_type: "text",
      },
    });

    if (response.code !== 0) {
      throw new Error(`Feishu reply failed: ${response.msg || `code ${response.code}`}`);
    }

    return {
      messageId: response.data?.message_id ?? "unknown",
      chatId: receiveId,
    };
  }

  const response = await client.im.message.create({
    params: { receive_id_type: receiveIdType },
    data: {
      receive_id: receiveId,
      content,
      msg_type: "text",
    },
  });

  if (response.code !== 0) {
    throw new Error(`Feishu send failed: ${response.msg || `code ${response.code}`}`);
  }

  return {
    messageId: response.data?.message_id ?? "unknown",
    chatId: receiveId,
  };
}

export type SendFeishuCardParams = {
  cfg: ClawdbotConfig;
  to: string;
  card: Record<string, unknown>;
  replyToMessageId?: string;
};

export async function sendCardFeishu(params: SendFeishuCardParams): Promise<FeishuSendResult> {
  const { cfg, to, card, replyToMessageId } = params;
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg) {
    throw new Error("Feishu channel not configured");
  }

  const client = createFeishuClient(feishuCfg);
  const receiveId = normalizeFeishuTarget(to);
  if (!receiveId) {
    throw new Error(`Invalid Feishu target: ${to}`);
  }

  const receiveIdType = resolveReceiveIdType(receiveId);
  const content = JSON.stringify(card);

  if (replyToMessageId) {
    const response = await client.im.message.reply({
      path: { message_id: replyToMessageId },
      data: {
        content,
        msg_type: "interactive",
      },
    });

    if (response.code !== 0) {
      throw new Error(`Feishu card reply failed: ${response.msg || `code ${response.code}`}`);
    }

    return {
      messageId: response.data?.message_id ?? "unknown",
      chatId: receiveId,
    };
  }

  const response = await client.im.message.create({
    params: { receive_id_type: receiveIdType },
    data: {
      receive_id: receiveId,
      content,
      msg_type: "interactive",
    },
  });

  if (response.code !== 0) {
    throw new Error(`Feishu card send failed: ${response.msg || `code ${response.code}`}`);
  }

  return {
    messageId: response.data?.message_id ?? "unknown",
    chatId: receiveId,
  };
}

export async function updateCardFeishu(params: {
  cfg: ClawdbotConfig;
  messageId: string;
  card: Record<string, unknown>;
}): Promise<void> {
  const { cfg, messageId, card } = params;
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg) {
    throw new Error("Feishu channel not configured");
  }

  const client = createFeishuClient(feishuCfg);
  const content = JSON.stringify(card);

  const response = await client.im.message.patch({
    path: { message_id: messageId },
    data: { content },
  });

  if (response.code !== 0) {
    throw new Error(`Feishu card update failed: ${response.msg || `code ${response.code}`}`);
  }
}

/**
 * Build a Feishu interactive card with markdown content.
 * Cards render markdown properly (code blocks, tables, links, etc.)
 */
export function buildMarkdownCard(text: string): Record<string, unknown> {
  return {
    config: {
      wide_screen_mode: true,
    },
    elements: [
      {
        tag: "markdown",
        content: text,
      },
    ],
  };
}

/**
 * Send a message as a markdown card (interactive message).
 * This renders markdown properly in Feishu (code blocks, tables, bold/italic, etc.)
 */
export async function sendMarkdownCardFeishu(params: {
  cfg: ClawdbotConfig;
  to: string;
  text: string;
  replyToMessageId?: string;
}): Promise<FeishuSendResult> {
  const { cfg, to, text, replyToMessageId } = params;
  const card = buildMarkdownCard(text);
  return sendCardFeishu({ cfg, to, card, replyToMessageId });
}

/**
 * Edit an existing text message.
 * Note: Feishu only allows editing messages within 24 hours.
 */
export async function editMessageFeishu(params: {
  cfg: ClawdbotConfig;
  messageId: string;
  text: string;
}): Promise<void> {
  const { cfg, messageId, text } = params;
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg) {
    throw new Error("Feishu channel not configured");
  }

  const client = createFeishuClient(feishuCfg);
  const tableMode = getFeishuRuntime().channel.text.resolveMarkdownTableMode({
    cfg,
    channel: "feishu",
  });
  const messageText = getFeishuRuntime().channel.text.convertMarkdownTables(text ?? "", tableMode);
  const content = JSON.stringify({ text: messageText });

  const response = await client.im.message.update({
    path: { message_id: messageId },
    data: {
      msg_type: "text",
      content,
    },
  });

  if (response.code !== 0) {
    throw new Error(`Feishu message edit failed: ${response.msg || `code ${response.code}`}`);
  }
}

/**
 * List messages from a chat with pagination support.
 * Useful for fetching chat history for summarization.
 */
export async function listMessagesFeishu(params: {
  cfg: ClawdbotConfig;
  chatId: string;
  count?: number;
  startTime?: string;
  endTime?: string;
  pageToken?: string;
  sortType?: "ByCreateTimeAsc" | "ByCreateTimeDesc";
}): Promise<ListMessagesResult> {
  const {
    cfg,
    chatId,
    count = 200,
    startTime,
    endTime,
    pageToken,
    sortType = "ByCreateTimeDesc",
  } = params;
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg) {
    throw new Error("Feishu channel not configured");
  }

  const client = createFeishuClient(feishuCfg);
  const messages: FeishuHistoryMessage[] = [];
  let currentPageToken = pageToken;
  let hasMore = true;

  // API max page_size is 50
  const pageSize = Math.min(50, count);

  while (hasMore && messages.length < count) {
    const response = await client.im.message.list({
      params: {
        container_id_type: "chat",
        container_id: chatId,
        page_size: pageSize,
        page_token: currentPageToken,
        start_time: startTime,
        end_time: endTime,
        sort_type: sortType,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Feishu list messages failed: ${response.msg || `code ${response.code}`}`);
    }

    const items = (response.data as any)?.items ?? [];
    for (const item of items) {
      if (messages.length >= count) break;

      // Parse content based on message type
      let content = item.body?.content ?? "";
      try {
        const parsed = JSON.parse(content);
        if (item.msg_type === "text" && parsed.text) {
          content = parsed.text;
        } else if (item.msg_type === "image") {
          content = "[图片]";
        } else if (item.msg_type === "file") {
          content = "[文件]";
        } else if (item.msg_type === "audio") {
          content = "[语音]";
        } else if (item.msg_type === "video") {
          content = "[视频]";
        } else if (item.msg_type === "sticker") {
          content = "[表情]";
        } else if (item.msg_type === "interactive") {
          content = "[卡片消息]";
        } else if (item.msg_type === "share_chat") {
          content = "[分享群聊]";
        } else if (item.msg_type === "share_user") {
          content = "[分享用户]";
        }
      } catch {
        // Keep raw content if parsing fails
      }

      messages.push({
        messageId: item.message_id ?? "",
        senderId: item.sender?.id ?? "",
        senderType: item.sender?.sender_type ?? "",
        content,
        contentType: item.msg_type ?? "text",
        createTime: item.create_time ? parseInt(item.create_time, 10) : 0,
        deleted: item.deleted,
      });
    }

    hasMore = (response.data as any)?.has_more ?? false;
    currentPageToken = (response.data as any)?.page_token;

    if (!currentPageToken) {
      hasMore = false;
    }
  }

  return {
    messages,
    hasMore,
    pageToken: currentPageToken,
    total: messages.length,
  };
}
