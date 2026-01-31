import type { ClawdbotConfig, RuntimeEnv } from "clawdbot/plugin-sdk";
import {
  buildPendingHistoryContextFromMap,
  recordPendingHistoryEntryIfEnabled,
  clearHistoryEntriesIfEnabled,
  DEFAULT_GROUP_HISTORY_LIMIT,
  type HistoryEntry,
} from "clawdbot/plugin-sdk";
import type { FeishuConfig, FeishuMessageContext } from "./types.js";
import { getFeishuRuntime } from "./runtime.js";
import {
  resolveFeishuGroupConfig,
  resolveFeishuReplyPolicy,
  resolveFeishuAllowlistMatch,
  isFeishuGroupAllowed,
} from "./policy.js";
import { createFeishuReplyDispatcher } from "./reply-dispatcher.js";
import { getMessageFeishu, listMessagesFeishu, type FeishuHistoryMessage } from "./send.js";
import { downloadFeishuImage, downloadFeishuVideo, type DownloadedMedia } from "./media.js";

export type FeishuMessageEvent = {
  sender: {
    sender_id: {
      open_id?: string;
      user_id?: string;
      union_id?: string;
    };
    sender_type?: string;
    tenant_key?: string;
  };
  message: {
    message_id: string;
    root_id?: string;
    parent_id?: string;
    chat_id: string;
    chat_type: "p2p" | "group";
    message_type: string;
    content: string;
    mentions?: Array<{
      key: string;
      id: {
        open_id?: string;
        user_id?: string;
        union_id?: string;
      };
      name: string;
      tenant_key?: string;
    }>;
  };
};

export type FeishuBotAddedEvent = {
  chat_id: string;
  operator_id: {
    open_id?: string;
    user_id?: string;
    union_id?: string;
  };
  external: boolean;
  operator_tenant_key?: string;
};

function parseMessageContent(content: string, messageType: string): string {
  try {
    const parsed = JSON.parse(content);
    if (messageType === "text") {
      return parsed.text || "";
    }
    return content;
  } catch {
    return content;
  }
}

function checkBotMentioned(event: FeishuMessageEvent, botOpenId?: string): boolean {
  const mentions = event.message.mentions ?? [];
  if (mentions.length === 0) return false;
  if (!botOpenId) return mentions.length > 0;
  return mentions.some((m) => m.id.open_id === botOpenId);
}

function stripBotMention(text: string, mentions?: FeishuMessageEvent["message"]["mentions"]): string {
  if (!mentions || mentions.length === 0) return text;
  let result = text;
  for (const mention of mentions) {
    result = result.replace(new RegExp(`@${mention.name}\\s*`, "g"), "").trim();
    result = result.replace(new RegExp(mention.key, "g"), "").trim();
  }
  return result;
}

/**
 * History request detection patterns
 */
const HISTORY_REQUEST_PATTERNS = [
  /读取.*历史/i,
  /获取.*历史/i,
  /查看.*历史/i,
  /聊天记录/i,
  /历史消息/i,
  /历史记录/i,
  /chat\s*history/i,
  /message\s*history/i,
  /fetch.*history/i,
  /get.*history/i,
  /总结.*聊天/i,
  /聊天.*总结/i,
  /summarize.*chat/i,
  /chat.*summary/i,
];

/**
 * Check if user message is requesting chat history
 */
export function isHistoryRequest(content: string): boolean {
  const normalizedContent = content.toLowerCase().trim();
  return HISTORY_REQUEST_PATTERNS.some((pattern) => pattern.test(normalizedContent));
}

/**
 * Extract requested message count from user message
 * Returns default of 200 if not specified
 */
function extractHistoryCount(content: string): number {
  // Match patterns like "最近100条", "last 50 messages", "200条消息"
  const patterns = [
    /最近\s*(\d+)\s*条/,
    /(\d+)\s*条消息/,
    /(\d+)\s*条记录/,
    /last\s*(\d+)/i,
    /(\d+)\s*messages/i,
    /获取\s*(\d+)/,
    /读取\s*(\d+)/,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      if (num > 0 && num <= 1000) {
        return num;
      }
    }
  }

  return 200; // Default
}

export type ChatHistoryResult = {
  messages: FeishuHistoryMessage[];
  total: number;
  formatted: string;
};

/**
 * Fetch chat history and format it for agent context
 */
export async function fetchChatHistoryForAgent(params: {
  cfg: ClawdbotConfig;
  chatId: string;
  requestContent: string;
  runtime?: RuntimeEnv;
}): Promise<ChatHistoryResult> {
  const { cfg, chatId, requestContent, runtime } = params;
  const log = runtime?.log ?? console.log;

  const count = extractHistoryCount(requestContent);
  log(`feishu: fetching ${count} messages from chat ${chatId}`);

  const result = await listMessagesFeishu({
    cfg,
    chatId,
    count,
    sortType: "ByCreateTimeDesc",
  });

  // Format messages for agent (reverse to chronological order)
  const chronologicalMessages = [...result.messages].reverse();

  const formatted = chronologicalMessages
    .filter((msg) => !msg.deleted && msg.content.trim())
    .map((msg) => {
      const time = new Date(msg.createTime).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      const sender = msg.senderType === "app" ? "[Bot]" : msg.senderId;
      return `[${time}] ${sender}: ${msg.content}`;
    })
    .join("\n");

  log(`feishu: fetched ${result.total} messages, formatted ${chronologicalMessages.length} for agent`);

  return {
    messages: result.messages,
    total: result.total,
    formatted,
  };
}

export function parseFeishuMessageEvent(
  event: FeishuMessageEvent,
  botOpenId?: string,
): FeishuMessageContext {
  const rawContent = parseMessageContent(event.message.content, event.message.message_type);
  const mentionedBot = checkBotMentioned(event, botOpenId);
  const content = stripBotMention(rawContent, event.message.mentions);

  return {
    chatId: event.message.chat_id,
    messageId: event.message.message_id,
    senderId: event.sender.sender_id.user_id || event.sender.sender_id.open_id || "",
    senderOpenId: event.sender.sender_id.open_id || "",
    chatType: event.message.chat_type,
    mentionedBot,
    rootId: event.message.root_id || undefined,
    parentId: event.message.parent_id || undefined,
    content,
    contentType: event.message.message_type,
  };
}

export async function handleFeishuMessage(params: {
  cfg: ClawdbotConfig;
  event: FeishuMessageEvent;
  botOpenId?: string;
  runtime?: RuntimeEnv;
  chatHistories?: Map<string, HistoryEntry[]>;
}): Promise<void> {
  const { cfg, event, botOpenId, runtime, chatHistories } = params;
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  const log = runtime?.log ?? console.log;
  const error = runtime?.error ?? console.error;

  const ctx = parseFeishuMessageEvent(event, botOpenId);
  const isGroup = ctx.chatType === "group";

  log(`feishu: received message from ${ctx.senderOpenId} in ${ctx.chatId} (${ctx.chatType}) contentType=${ctx.contentType}`);

  const historyLimit = Math.max(
    0,
    feishuCfg?.historyLimit ?? cfg.messages?.groupChat?.historyLimit ?? DEFAULT_GROUP_HISTORY_LIMIT,
  );

  if (isGroup) {
    const groupPolicy = feishuCfg?.groupPolicy ?? "open";
    const groupAllowFrom = feishuCfg?.groupAllowFrom ?? [];
    const groupConfig = resolveFeishuGroupConfig({ cfg: feishuCfg, groupId: ctx.chatId });

    // Check if this GROUP is allowed (groupAllowFrom contains group IDs, not user IDs)
    const allowed = isFeishuGroupAllowed({
      groupPolicy,
      allowFrom: groupAllowFrom,
      senderId: ctx.chatId,  // Check group ID, not sender ID
      senderName: undefined,
    });

    if (!allowed) {
      log(`feishu: group ${ctx.chatId} not in allowlist`);
      return;
    }

    // Additional sender-level allowlist check if group has specific allowFrom config
    const senderAllowFrom = groupConfig?.allowFrom ?? [];
    if (senderAllowFrom.length > 0) {
      const senderAllowed = isFeishuGroupAllowed({
        groupPolicy: "allowlist",
        allowFrom: senderAllowFrom,
        senderId: ctx.senderOpenId,
        senderName: ctx.senderName,
      });
      if (!senderAllowed) {
        log(`feishu: sender ${ctx.senderOpenId} not in group ${ctx.chatId} allowlist`);
        return;
      }
    }

    const { requireMention } = resolveFeishuReplyPolicy({
      isDirectMessage: false,
      globalConfig: feishuCfg,
      groupConfig,
    });

    if (requireMention && !ctx.mentionedBot) {
      log(`feishu: message in group ${ctx.chatId} did not mention bot, recording to history`);
      if (chatHistories) {
        recordPendingHistoryEntryIfEnabled({
          historyMap: chatHistories,
          historyKey: ctx.chatId,
          limit: historyLimit,
          entry: {
            sender: ctx.senderOpenId,
            body: ctx.content,
            timestamp: Date.now(),
            messageId: ctx.messageId,
          },
        });
      }
      return;
    }
  } else {
    const dmPolicy = feishuCfg?.dmPolicy ?? "pairing";
    const allowFrom = feishuCfg?.allowFrom ?? [];

    if (dmPolicy === "allowlist") {
      const match = resolveFeishuAllowlistMatch({
        allowFrom,
        senderId: ctx.senderOpenId,
      });
      if (!match.allowed) {
        log(`feishu: sender ${ctx.senderOpenId} not in DM allowlist`);
        return;
      }
    }
  }

  try {
    const core = getFeishuRuntime();

    const feishuFrom = isGroup ? `feishu:group:${ctx.chatId}` : `feishu:${ctx.senderOpenId}`;
    const feishuTo = isGroup ? `chat:${ctx.chatId}` : `user:${ctx.senderOpenId}`;

    const route = core.channel.routing.resolveAgentRoute({
      cfg,
      channel: "feishu",
      peer: {
        kind: isGroup ? "group" : "dm",
        id: isGroup ? ctx.chatId : ctx.senderOpenId,
      },
    });

    const preview = ctx.content.replace(/\s+/g, " ").slice(0, 160);
    const inboundLabel = isGroup
      ? `Feishu message in group ${ctx.chatId}`
      : `Feishu DM from ${ctx.senderOpenId}`;

    core.system.enqueueSystemEvent(`${inboundLabel}: ${preview}`, {
      sessionKey: route.sessionKey,
      contextKey: `feishu:message:${ctx.chatId}:${ctx.messageId}`,
    });

    // Fetch quoted/replied message content if parentId exists
    let quotedContent: string | undefined;
    if (ctx.parentId) {
      try {
        const quotedMsg = await getMessageFeishu({ cfg, messageId: ctx.parentId });
        if (quotedMsg) {
          quotedContent = quotedMsg.content;
          log(`feishu: fetched quoted message: ${quotedContent?.slice(0, 100)}`);
        }
      } catch (err) {
        log(`feishu: failed to fetch quoted message: ${String(err)}`);
      }
    }

    const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(cfg);

    // Handle media messages - download and prepare for agent
    // Feishu sends media in various formats:
    // 1. Pure image: contentType="image", content={"image_key":"..."}
    // 2. Rich text with image: contentType="post", content={"content":[[{"tag":"img","image_key":"..."}]]}
    // 3. Video/media: contentType="video" or "media", content={"file_key":"...", "image_key":"..."}
    let downloadedMedia: DownloadedMedia | undefined;
    let mediaPlaceholder = "";
    let extractedImageKey: string | undefined;
    let extractedFileKey: string | undefined;
    let extractedText = "";

    try {
      const parsedContent = JSON.parse(event.message.content);

      if (ctx.contentType === "image") {
        // Pure image message
        extractedImageKey = parsedContent.image_key;
      } else if (ctx.contentType === "video" || ctx.contentType === "media") {
        // Video/media message: file_key is the video, image_key is the thumbnail
        extractedFileKey = parsedContent.file_key;
        extractedImageKey = parsedContent.image_key; // thumbnail
      } else if (ctx.contentType === "post") {
        // Rich text message - look for img tags
        const contentArray = parsedContent.content;
        if (Array.isArray(contentArray)) {
          for (const row of contentArray) {
            if (Array.isArray(row)) {
              for (const item of row) {
                if (item.tag === "img" && item.image_key) {
                  extractedImageKey = item.image_key;
                } else if (item.tag === "text" && item.text) {
                  extractedText += item.text;
                }
              }
            }
          }
        }
      }

      // Download video if present
      if (extractedFileKey) {
        log(`feishu: detected video message, attempting to download: ${extractedFileKey}`);
        downloadedMedia = await downloadFeishuVideo({
          cfg,
          messageId: ctx.messageId,
          fileKey: extractedFileKey,
        });
        mediaPlaceholder = "<media:video>";
        log(`feishu: video downloaded to ${downloadedMedia.path}`);
      }
      // Download image if present (and no video was downloaded)
      else if (extractedImageKey) {
        log(`feishu: detected image message, attempting to download: ${extractedImageKey}`);
        downloadedMedia = await downloadFeishuImage({
          cfg,
          messageId: ctx.messageId,
          imageKey: extractedImageKey,
        });
        mediaPlaceholder = "<media:image>";
        log(`feishu: image downloaded to ${downloadedMedia.path}`);
      }
    } catch (err) {
      log(`feishu: failed to process/download media: ${String(err)}`);
      // Continue without media
    }

    // Use extracted text if available (from post messages)
    const textContent = extractedText.trim() || ctx.content;

    // Build message body with quoted content if available
    let messageBody = textContent || mediaPlaceholder;
    if (quotedContent) {
      messageBody = `[Replying to: "${quotedContent}"]\n\n${textContent || mediaPlaceholder}`;
    }

    // Check if user is requesting chat history
    let historyContext = "";
    if (isGroup && isHistoryRequest(ctx.content)) {
      try {
        log(`feishu: detected history request in message`);
        const historyResult = await fetchChatHistoryForAgent({
          cfg,
          chatId: ctx.chatId,
          requestContent: ctx.content,
          runtime,
        });

        if (historyResult.formatted) {
          historyContext = `\n\n--- 群聊历史记录 (最近 ${historyResult.total} 条消息) ---\n${historyResult.formatted}\n--- 历史记录结束 ---\n\n`;
          log(`feishu: included ${historyResult.total} history messages in context`);
        }
      } catch (err) {
        error(`feishu: failed to fetch chat history: ${String(err)}`);
        // Continue without history, don't block the message
      }
    }

    // Prepend history context if available
    if (historyContext) {
      messageBody = historyContext + messageBody;
    }

    const body = core.channel.reply.formatAgentEnvelope({
      channel: "Feishu",
      from: isGroup ? ctx.chatId : ctx.senderOpenId,
      timestamp: new Date(),
      envelope: envelopeOptions,
      body: messageBody,
    });

    let combinedBody = body;
    const historyKey = isGroup ? ctx.chatId : undefined;

    if (isGroup && historyKey && chatHistories) {
      combinedBody = buildPendingHistoryContextFromMap({
        historyMap: chatHistories,
        historyKey,
        limit: historyLimit,
        currentMessage: combinedBody,
        formatEntry: (entry) =>
          core.channel.reply.formatAgentEnvelope({
            channel: "Feishu",
            from: ctx.chatId,
            timestamp: entry.timestamp,
            body: `${entry.sender}: ${entry.body}`,
            envelope: envelopeOptions,
          }),
      });
    }

    const ctxPayload = core.channel.reply.finalizeInboundContext({
      Body: combinedBody,
      RawBody: textContent || mediaPlaceholder,
      CommandBody: textContent || mediaPlaceholder,
      From: feishuFrom,
      To: feishuTo,
      SessionKey: route.sessionKey,
      AccountId: route.accountId,
      ChatType: isGroup ? "group" : "direct",
      GroupSubject: isGroup ? ctx.chatId : undefined,
      SenderName: ctx.senderOpenId,
      SenderId: ctx.senderOpenId,
      Provider: "feishu" as const,
      Surface: "feishu" as const,
      MessageSid: ctx.messageId,
      Timestamp: Date.now(),
      WasMentioned: ctx.mentionedBot,
      CommandAuthorized: true,
      OriginatingChannel: "feishu" as const,
      OriginatingTo: feishuTo,
      // Media fields for image support
      MediaPath: downloadedMedia?.path,
      MediaUrl: downloadedMedia?.path,
      MediaType: downloadedMedia?.contentType,
      MediaPaths: downloadedMedia ? [downloadedMedia.path] : undefined,
      MediaUrls: downloadedMedia ? [downloadedMedia.path] : undefined,
      MediaTypes: downloadedMedia ? [downloadedMedia.contentType] : undefined,
    });

    const { dispatcher, replyOptions, markDispatchIdle } = createFeishuReplyDispatcher({
      cfg,
      agentId: route.agentId,
      runtime: runtime as RuntimeEnv,
      chatId: ctx.chatId,
      replyToMessageId: ctx.messageId,
    });

    log(`feishu: dispatching to agent (session=${route.sessionKey})`);

    const { queuedFinal, counts } = await core.channel.reply.dispatchReplyFromConfig({
      ctx: ctxPayload,
      cfg,
      dispatcher,
      replyOptions,
    });

    markDispatchIdle();

    if (isGroup && historyKey && chatHistories) {
      clearHistoryEntriesIfEnabled({
        historyMap: chatHistories,
        historyKey,
        limit: historyLimit,
      });
    }

    log(`feishu: dispatch complete (queuedFinal=${queuedFinal}, replies=${counts.final})`);
  } catch (err) {
    error(`feishu: failed to dispatch message: ${String(err)}`);
  }
}
