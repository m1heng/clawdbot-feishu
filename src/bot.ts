import type { ClawdbotConfig, RuntimeEnv } from "openclaw/plugin-sdk";
import {
  buildPendingHistoryContextFromMap,
  recordPendingHistoryEntryIfEnabled,
  clearHistoryEntriesIfEnabled,
  DEFAULT_GROUP_HISTORY_LIMIT,
  type HistoryEntry,
} from "openclaw/plugin-sdk";
import type { FeishuConfig, FeishuMessageContext, FeishuMediaInfo, FeishuHistoryMessage } from "./types.js";
import { getFeishuRuntime } from "./runtime.js";
import { createFeishuClient } from "./client.js";
import {
  resolveFeishuGroupConfig,
  resolveFeishuReplyPolicy,
  resolveFeishuAllowlistMatch,
  isFeishuGroupAllowed,
} from "./policy.js";
import { createFeishuReplyDispatcher } from "./reply-dispatcher.js";
import { getMessageFeishu, listMessagesFeishu } from "./send.js";
import { downloadImageFeishu, downloadMessageResourceFeishu } from "./media.js";

// --- Chat history request patterns ---
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

// --- Sender name resolution (so the agent can distinguish who is speaking in group chats) ---
// Cache display names by open_id to avoid an API call on every message.
const SENDER_NAME_TTL_MS = 10 * 60 * 1000;
const senderNameCache = new Map<string, { name: string; expireAt: number }>();

async function resolveFeishuSenderName(params: {
  feishuCfg?: FeishuConfig;
  senderOpenId: string;
  log: (...args: any[]) => void;
}): Promise<string | undefined> {
  const { feishuCfg, senderOpenId, log } = params;
  if (!feishuCfg) return undefined;
  if (!senderOpenId) return undefined;

  const cached = senderNameCache.get(senderOpenId);
  const now = Date.now();
  if (cached && cached.expireAt > now) return cached.name;

  try {
    const client = createFeishuClient(feishuCfg);

    // contact/v3/users/:user_id?user_id_type=open_id
    const res: any = await client.contact.user.get({
      path: { user_id: senderOpenId },
      params: { user_id_type: "open_id" },
    });

    const name: string | undefined =
      res?.data?.user?.name ||
      res?.data?.user?.display_name ||
      res?.data?.user?.nickname ||
      res?.data?.user?.en_name;

    if (name && typeof name === "string") {
      senderNameCache.set(senderOpenId, { name, expireAt: now + SENDER_NAME_TTL_MS });
      return name;
    }

    return undefined;
  } catch (err) {
    // Best-effort. Don't fail message handling if name lookup fails.
    log(`feishu: failed to resolve sender name for ${senderOpenId}: ${String(err)}`);
    return undefined;
  }
}

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
    if (messageType === "post") {
      // Extract text content from rich text post
      const { textContent } = parsePostContent(content);
      return textContent;
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
 * Parse media keys from message content based on message type.
 */
function parseMediaKeys(
  content: string,
  messageType: string,
): {
  imageKey?: string;
  fileKey?: string;
  fileName?: string;
} {
  try {
    const parsed = JSON.parse(content);
    switch (messageType) {
      case "image":
        return { imageKey: parsed.image_key };
      case "file":
        return { fileKey: parsed.file_key, fileName: parsed.file_name };
      case "audio":
        return { fileKey: parsed.file_key };
      case "video":
        // Video has both file_key (video) and image_key (thumbnail)
        return { fileKey: parsed.file_key, imageKey: parsed.image_key };
      case "sticker":
        return { fileKey: parsed.file_key };
      default:
        return {};
    }
  } catch {
    return {};
  }
}

/**
 * Parse post (rich text) content and extract embedded image keys.
 * Post structure: { title?: string, content: [[{ tag, text?, image_key?, ... }]] }
 */
function parsePostContent(content: string): {
  textContent: string;
  imageKeys: string[];
} {
  try {
    const parsed = JSON.parse(content);
    const title = parsed.title || "";
    const contentBlocks = parsed.content || [];
    let textContent = title ? `${title}\n\n` : "";
    const imageKeys: string[] = [];

    for (const paragraph of contentBlocks) {
      if (Array.isArray(paragraph)) {
        for (const element of paragraph) {
          if (element.tag === "text") {
            textContent += element.text || "";
          } else if (element.tag === "a") {
            // Link: show text or href
            textContent += element.text || element.href || "";
          } else if (element.tag === "at") {
            // Mention: @username
            textContent += `@${element.user_name || element.user_id || ""}`;
          } else if (element.tag === "img" && element.image_key) {
            // Embedded image
            imageKeys.push(element.image_key);
          }
        }
        textContent += "\n";
      }
    }

    return {
      textContent: textContent.trim() || "[富文本消息]",
      imageKeys,
    };
  } catch {
    return { textContent: "[富文本消息]", imageKeys: [] };
  }
}

/**
 * Infer placeholder text based on message type.
 */
function inferPlaceholder(messageType: string): string {
  switch (messageType) {
    case "image":
      return "<media:image>";
    case "file":
      return "<media:document>";
    case "audio":
      return "<media:audio>";
    case "video":
      return "<media:video>";
    case "sticker":
      return "<media:sticker>";
    default:
      return "<media:document>";
  }
}

/**
 * Resolve media from a Feishu message, downloading and saving to disk.
 * Similar to Discord's resolveMediaList().
 */
async function resolveFeishuMediaList(params: {
  cfg: ClawdbotConfig;
  messageId: string;
  messageType: string;
  content: string;
  maxBytes: number;
  log?: (msg: string) => void;
}): Promise<FeishuMediaInfo[]> {
  const { cfg, messageId, messageType, content, maxBytes, log } = params;

  // Only process media message types (including post for embedded images)
  const mediaTypes = ["image", "file", "audio", "video", "sticker", "post"];
  if (!mediaTypes.includes(messageType)) {
    return [];
  }

  const out: FeishuMediaInfo[] = [];
  const core = getFeishuRuntime();

  // Handle post (rich text) messages with embedded images
  if (messageType === "post") {
    const { imageKeys } = parsePostContent(content);
    if (imageKeys.length === 0) {
      return [];
    }

    log?.(`feishu: post message contains ${imageKeys.length} embedded image(s)`);

    for (const imageKey of imageKeys) {
      try {
        // Embedded images in post use messageResource API with image_key as file_key
        const result = await downloadMessageResourceFeishu({
          cfg,
          messageId,
          fileKey: imageKey,
          type: "image",
        });

        let contentType = result.contentType;
        if (!contentType) {
          contentType = await core.media.detectMime({ buffer: result.buffer });
        }

        const saved = await core.channel.media.saveMediaBuffer(
          result.buffer,
          contentType,
          "inbound",
          maxBytes,
        );

        out.push({
          path: saved.path,
          contentType: saved.contentType,
          placeholder: "<media:image>",
        });

        log?.(`feishu: downloaded embedded image ${imageKey}, saved to ${saved.path}`);
      } catch (err) {
        log?.(`feishu: failed to download embedded image ${imageKey}: ${String(err)}`);
      }
    }

    return out;
  }

  // Handle other media types
  const mediaKeys = parseMediaKeys(content, messageType);
  if (!mediaKeys.imageKey && !mediaKeys.fileKey) {
    return [];
  }

  try {
    let buffer: Buffer;
    let contentType: string | undefined;
    let fileName: string | undefined;

    // For message media, always use messageResource API
    // The image.get API is only for images uploaded via im/v1/images, not for message attachments
    const fileKey = mediaKeys.imageKey || mediaKeys.fileKey;
    if (!fileKey) {
      return [];
    }

    const resourceType = messageType === "image" ? "image" : "file";
    const result = await downloadMessageResourceFeishu({
      cfg,
      messageId,
      fileKey,
      type: resourceType,
    });
    buffer = result.buffer;
    contentType = result.contentType;
    fileName = result.fileName || mediaKeys.fileName;

    // Detect mime type if not provided
    if (!contentType) {
      contentType = await core.media.detectMime({ buffer });
    }

    // Save to disk using core's saveMediaBuffer
    const saved = await core.channel.media.saveMediaBuffer(
      buffer,
      contentType,
      "inbound",
      maxBytes,
      fileName,
    );

    out.push({
      path: saved.path,
      contentType: saved.contentType,
      placeholder: inferPlaceholder(messageType),
    });

    log?.(`feishu: downloaded ${messageType} media, saved to ${saved.path}`);
  } catch (err) {
    log?.(`feishu: failed to download ${messageType} media: ${String(err)}`);
  }

  return out;
}

/**
 * Build media payload for inbound context.
 * Similar to Discord's buildDiscordMediaPayload().
 */
function buildFeishuMediaPayload(
  mediaList: FeishuMediaInfo[],
): {
  MediaPath?: string;
  MediaType?: string;
  MediaUrl?: string;
  MediaPaths?: string[];
  MediaUrls?: string[];
  MediaTypes?: string[];
} {
  const first = mediaList[0];
  const mediaPaths = mediaList.map((media) => media.path);
  const mediaTypes = mediaList.map((media) => media.contentType).filter(Boolean) as string[];
  return {
    MediaPath: first?.path,
    MediaType: first?.contentType,
    MediaUrl: first?.path,
    MediaPaths: mediaPaths.length > 0 ? mediaPaths : undefined,
    MediaUrls: mediaPaths.length > 0 ? mediaPaths : undefined,
    MediaTypes: mediaTypes.length > 0 ? mediaTypes : undefined,
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

  let ctx = parseFeishuMessageEvent(event, botOpenId);
  const isGroup = ctx.chatType === "group";

  // Resolve sender display name (best-effort) so the agent can attribute messages correctly.
  const senderName = await resolveFeishuSenderName({
    feishuCfg,
    senderOpenId: ctx.senderOpenId,
    log,
  });
  if (senderName) ctx = { ...ctx, senderName };

  log(`feishu: received message from ${ctx.senderOpenId} in ${ctx.chatId} (${ctx.chatType})`);

  const historyLimit = Math.max(
    0,
    feishuCfg?.historyLimit ?? cfg.messages?.groupChat?.historyLimit ?? DEFAULT_GROUP_HISTORY_LIMIT,
  );

  if (isGroup) {
    const groupPolicy = feishuCfg?.groupPolicy ?? "open";
    const groupAllowFrom = feishuCfg?.groupAllowFrom ?? [];
    const groupConfig = resolveFeishuGroupConfig({ cfg: feishuCfg, groupId: ctx.chatId });

    const senderAllowFrom = groupConfig?.allowFrom ?? groupAllowFrom;
    const allowed = isFeishuGroupAllowed({
      groupPolicy,
      allowFrom: senderAllowFrom,
      senderId: ctx.senderOpenId,
      senderName: ctx.senderName,
    });

    if (!allowed) {
      log(`feishu: sender ${ctx.senderOpenId} not in group allowlist`);
      return;
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
            body: `${ctx.senderName ?? ctx.senderOpenId}: ${ctx.content}`,
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

    // In group chats, the session is scoped to the group, but the *speaker* is the sender.
    // Using a group-scoped From causes the agent to treat different users as the same person.
    const feishuFrom = `feishu:${ctx.senderOpenId}`;
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

    // Resolve media from message
    const mediaMaxBytes = (feishuCfg?.mediaMaxMb ?? 30) * 1024 * 1024; // 30MB default
    const mediaList = await resolveFeishuMediaList({
      cfg,
      messageId: ctx.messageId,
      messageType: event.message.message_type,
      content: event.message.content,
      maxBytes: mediaMaxBytes,
      log,
    });
    const mediaPayload = buildFeishuMediaPayload(mediaList);

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

    // Check if user is requesting chat history for summarization
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

    // Build message body with quoted content if available
    let messageBody = ctx.content;
    if (quotedContent) {
      messageBody = `[Replying to: "${quotedContent}"]\n\n${ctx.content}`;
    }

    // Prepend history context if available
    if (historyContext) {
      messageBody = historyContext + messageBody;
    }

    // Include a readable speaker label so the model can attribute instructions.
    // (DMs already have per-sender sessions, but the prefix is still useful for clarity.)
    const speaker = ctx.senderName ?? ctx.senderOpenId;
    messageBody = `${speaker}: ${messageBody}`;

    const envelopeFrom = isGroup ? `${ctx.chatId}:${ctx.senderOpenId}` : ctx.senderOpenId;

    const body = core.channel.reply.formatAgentEnvelope({
      channel: "Feishu",
      from: envelopeFrom,
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
            // Preserve speaker identity in group history as well.
            from: `${ctx.chatId}:${entry.sender}`,
            timestamp: entry.timestamp,
            body: entry.body,
            envelope: envelopeOptions,
          }),
      });
    }

    const ctxPayload = core.channel.reply.finalizeInboundContext({
      Body: combinedBody,
      RawBody: ctx.content,
      CommandBody: ctx.content,
      From: feishuFrom,
      To: feishuTo,
      SessionKey: route.sessionKey,
      AccountId: route.accountId,
      ChatType: isGroup ? "group" : "direct",
      GroupSubject: isGroup ? ctx.chatId : undefined,
      SenderName: ctx.senderName ?? ctx.senderOpenId,
      SenderId: ctx.senderOpenId,
      Provider: "feishu" as const,
      Surface: "feishu" as const,
      MessageSid: ctx.messageId,
      Timestamp: Date.now(),
      WasMentioned: ctx.mentionedBot,
      CommandAuthorized: true,
      OriginatingChannel: "feishu" as const,
      OriginatingTo: feishuTo,
      ...mediaPayload,
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
