import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import type { FeishuSendResult, ResolvedFeishuAccount } from "./types.js";
import type { MentionTarget } from "./mention.js";
import { buildMentionedMessage, buildMentionedCardContent } from "./mention.js";
import { createFeishuClient } from "./client.js";
import { normalizeFeishuMarkdownLinks } from "./text/markdown-links.js";
import { resolveReceiveIdType, normalizeFeishuTarget } from "./targets.js";
import { getFeishuRuntime } from "./runtime.js";
import { listFeishuAccountIds, resolveFeishuAccount } from "./accounts.js";

export type FeishuMessageInfo = {
  messageId: string;
  chatId: string;
  senderId?: string;
  senderOpenId?: string;
  senderName?: string;
  content: string;
  contentType: string;
  createTime?: number;
};

const MERGE_FORWARD_NAME_CACHE_TTL_MS = 10 * 60 * 1000;
const mergeForwardSenderNameCache = new Map<string, { name: string; expireAt: number }>();
const mergeForwardBotNameCache = new Map<string, { name: string; expireAt: number }>();
const mergeForwardAppNameCache = new Map<string, { name: string; expireAt: number }>();

type MergeForwardMention = {
  key?: string;
  id?: string;
  id_type?: string;
  name?: string;
};

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildMentionDisplayName(mention: MergeForwardMention): string | undefined {
  const mentionName = mention.name?.trim();
  if (mentionName) return mentionName;
  const mentionId = mention.id?.trim();
  if (!mentionId) return undefined;
  const mentionIdType = mention.id_type?.trim();
  return mentionIdType ? `${mentionIdType}:${mentionId}` : mentionId;
}

function replaceFeishuMentionPlaceholders(raw: string, mentions?: MergeForwardMention[]): string {
  if (!raw) return raw;
  let text = raw;

  if (Array.isArray(mentions)) {
    for (const mention of mentions) {
      const key = mention.key?.trim();
      if (!key) continue;
      const displayName = buildMentionDisplayName(mention);
      if (!displayName) continue;
      text = text.replace(new RegExp(escapeRegExp(key), "g"), `@${displayName}`);
    }
  }

  // Feishu text payloads may keep unresolved placeholders like "@_user_1".
  return text.replace(/@_user_\d+\b/g, "@mentioned");
}

async function resolveCurrentBotName(params: {
  client: any;
  appId: string;
}): Promise<string | undefined> {
  const cacheKey = `bot:${params.appId}`;
  const now = Date.now();
  const cached = mergeForwardBotNameCache.get(cacheKey);
  if (cached && cached.expireAt > now) {
    return cached.name;
  }

  if (typeof params.client?.request !== "function") return undefined;

  try {
    const response = await params.client.request({
      method: "GET",
      url: "/open-apis/bot/v3/info",
      data: {},
    });
    const botName = response?.data?.bot?.app_name;
    if (typeof botName === "string" && botName.trim()) {
      const normalized = botName.trim();
      mergeForwardBotNameCache.set(cacheKey, {
        name: normalized,
        expireAt: now + MERGE_FORWARD_NAME_CACHE_TTL_MS,
      });
      return normalized;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

async function resolveAppNameById(params: {
  client: any;
  accountId: string;
  appId: string;
}): Promise<string | undefined> {
  const appId = params.appId.trim();
  if (!appId) return undefined;

  const cacheKey = `${params.accountId}:${appId}`;
  const now = Date.now();
  const cached = mergeForwardAppNameCache.get(cacheKey);
  if (cached && cached.expireAt > now) {
    return cached.name;
  }

  if (typeof params.client?.request !== "function") return undefined;

  try {
    const response = await params.client.request({
      method: "GET",
      url: `/open-apis/application/v6/applications/${encodeURIComponent(appId)}`,
      params: {
        lang: "en_us",
      },
    });
    const appName = response?.data?.app?.app_name;
    if (typeof appName === "string" && appName.trim()) {
      const normalized = appName.trim();
      mergeForwardAppNameCache.set(cacheKey, {
        name: normalized,
        expireAt: now + MERGE_FORWARD_NAME_CACHE_TTL_MS,
      });
      return normalized;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolves a configured account's display name and accountId key by appId.
 * A single pass over the account list covers both the explicit-name lookup
 * and the accountId fallback label, avoiding duplicate iteration.
 */
function resolveConfiguredAppLabel(params: {
  cfg: ClawdbotConfig;
  appId: string;
}): { displayName: string | undefined; accountId: string | undefined } {
  const targetAppId = params.appId.trim();
  if (!targetAppId) return { displayName: undefined, accountId: undefined };

  for (const accountId of listFeishuAccountIds(params.cfg)) {
    const resolved = resolveFeishuAccount({ cfg: params.cfg, accountId });
    if (!resolved.configured) continue;
    if (resolved.appId !== targetAppId) continue;
    return { displayName: resolved.name?.trim() || undefined, accountId };
  }

  return { displayName: undefined, accountId: undefined };
}

function replaceConfiguredAppIdTokens(params: {
  content: string;
  cfg: ClawdbotConfig;
}): string {
  if (!params.content) return params.content;
  return params.content.replace(/\bapp_id:(cli_[a-z0-9]+)\b/g, (raw, appId: string) => {
    const { displayName, accountId } = resolveConfiguredAppLabel({ cfg: params.cfg, appId });
    return displayName ?? accountId ?? raw;
  });
}

function extractPlainTextFromMessageBody(
  rawContent: string,
  msgType?: string,
  mentions?: MergeForwardMention[],
): string {
  let content = rawContent;
  try {
    const parsed = JSON.parse(rawContent);
    if (msgType === "text" && parsed.text) {
      return replaceFeishuMentionPlaceholders(parsed.text, mentions);
    }
    if (typeof parsed.text === "string" && parsed.text.trim()) {
      return replaceFeishuMentionPlaceholders(parsed.text, mentions);
    }
    if (typeof parsed.title === "string" && parsed.title.trim()) {
      return parsed.title;
    }
    if (parsed.content || parsed.elements) {
      // Extract plain text from rich text (post) or interactive (card) format.
      // Both use nested arrays: Array<Array<{tag, text?, href?, ...}>>
      const blocks = parsed.content ?? parsed.elements ?? [];
      const lines: string[] = [];
      for (const paragraph of blocks) {
        if (!Array.isArray(paragraph)) continue;
        const line = paragraph
          .map((node: { tag?: string; text?: string; href?: string }) => {
            if (node.tag === "text") return node.text ?? "";
            if (node.tag === "a") return node.text ?? node.href ?? "";
            if (node.tag === "at") return "";
            if (node.tag === "img") return "[Image]";
            return node.text ?? "";
          })
          .join("");
        if (line.trim()) lines.push(line);
      }
      const extracted = (parsed.title ? parsed.title + "\n" : "") + lines.join("\n");
      // Filter out Feishu's degraded card placeholder text
      if (extracted.trim() && !extracted.includes("请升级至最新版本客户端")) {
        content = extracted;
      } else if (extracted.includes("请升级至最新版本客户端")) {
        content = "[Card message]";
      }
    }
  } catch {
    // Keep raw content if parsing fails
  }
  return replaceFeishuMentionPlaceholders(content, mentions);
}

function extractSenderLabelFromMessageBody(rawContent: string): string | undefined {
  try {
    const parsed = JSON.parse(rawContent);
    const senderName = parsed?.sender_name || parsed?.sender?.name;
    if (typeof senderName === "string" && senderName.trim()) {
      return senderName.trim();
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function buildMessageSenderLabel(params: {
  cfg: ClawdbotConfig;
  rawContent: string;
  client: any;
  accountId: string;
  sender?: {
    id?: string;
    id_type?: string;
    sender_type?: string;
  };
}): Promise<string | undefined> {
  const senderName = extractSenderLabelFromMessageBody(params.rawContent);
  if (senderName) return Promise.resolve(senderName);

  const senderId = params.sender?.id?.trim();
  const senderIdType = params.sender?.id_type?.trim();
  const senderType = params.sender?.sender_type?.trim();
  if (!senderId) return Promise.resolve(undefined);

  const localFallback = senderIdType ? `${senderIdType}:${senderId}` : senderId;

  if (senderType === "app") {
    const { displayName: configuredName, accountId: configuredAccountId } = resolveConfiguredAppLabel({
      cfg: params.cfg,
      appId: senderId,
    });
    if (configuredName) return Promise.resolve(configuredName);

    if (senderIdType === "app_id") {
      // For configured accounts, call /bot/v3/info with their own credentials to get the
      // actual Feishu display name — no special application:read permissions required.
      if (configuredAccountId !== undefined) {
        const acct = resolveFeishuAccount({ cfg: params.cfg, accountId: configuredAccountId });
        if (acct.configured) {
          // Isolate client creation so a synchronous throw doesn't propagate to getMessageFeishu's
          // outer catch and cause the entire message fetch to fail.
          let botClient: ReturnType<typeof createFeishuClient>;
          try {
            botClient = createFeishuClient(acct);
          } catch {
            return Promise.resolve(configuredAccountId);
          }
          return resolveCurrentBotName({
            client: botClient,
            appId: senderId,
          }).then((name) => name ?? configuredAccountId);
        }
      }
      // Unconfigured bots: best-effort via application info API.
      return resolveAppNameById({
        client: params.client,
        accountId: params.accountId,
        appId: senderId,
      }).then((name) => name ?? localFallback);
    }
    return Promise.resolve(localFallback);
  }

  // Best-effort contact lookup to recover missing sender names in merge_forward children.
  // Supported id types for contact API lookup: open_id / user_id / union_id.
  const lookupType =
    senderIdType === "open_id" || senderIdType === "user_id" || senderIdType === "union_id"
      ? senderIdType
      : undefined;
  const contactGet = params.client?.contact?.user?.get;
  if (!lookupType || typeof contactGet !== "function") {
    return Promise.resolve(localFallback);
  }

  const cacheKey = `${params.accountId}:${lookupType}:${senderId}`;
  const now = Date.now();
  const cached = mergeForwardSenderNameCache.get(cacheKey);
  if (cached && cached.expireAt > now) {
    return Promise.resolve(cached.name);
  }

  return contactGet({
    path: { user_id: senderId },
    params: { user_id_type: lookupType },
  })
    .then((res: any) => {
      const resolvedName =
        res?.data?.user?.name ||
        res?.data?.user?.nickname;
      const finalName =
        typeof resolvedName === "string" && resolvedName.trim() ? resolvedName.trim() : localFallback;
      mergeForwardSenderNameCache.set(cacheKey, {
        name: finalName,
        expireAt: now + MERGE_FORWARD_NAME_CACHE_TTL_MS,
      });
      return finalName;
    })
    .catch(() => localFallback);
}

/**
 * Get a message by its ID.
 * Useful for fetching quoted/replied message content.
 */
export async function getMessageFeishu(params: {
  cfg: ClawdbotConfig;
  messageId: string;
  accountId?: string;
}): Promise<FeishuMessageInfo | null> {
  const { cfg, messageId, accountId } = params;
  const account = resolveFeishuAccount({ cfg, accountId });
  if (!account.configured) {
    throw new Error(`Feishu account "${account.accountId}" not configured`);
  }

  const client = createFeishuClient(account);

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
          mentions?: Array<{
            key?: string;
            id?: string;
            id_type?: string;
            name?: string;
          }>;
          create_time?: string;
        }>;
      };
    };

    if (response.code !== 0) {
      return null;
    }

    const items = response.data?.items;
    if (!items || items.length === 0) {
      return null;
    }

    // For merge_forward type, items contains the merge message + child messages.
    // Use child messages when present; otherwise fall back to first item for safety.
    const isMergeForward = items[0]?.msg_type === "merge_forward";
    const hasExpandedMergeForwardChildren = isMergeForward && items.length > 1;
    const messagesToProcess = hasExpandedMergeForwardChildren ? items.slice(1) : items.slice(0, 1);

    // Parse each message and combine content.
    const parsedContents: string[] = [];
    for (const item of messagesToProcess) {
      const rawContent = item.body?.content ?? "";
      const extractedContent = extractPlainTextFromMessageBody(rawContent, item.msg_type, item.mentions);
      const content = isMergeForward
        ? replaceConfiguredAppIdTokens({
            content: extractedContent,
            cfg,
          })
        : extractedContent;
      if (content.trim()) {
        // Add sender label only for merge_forward expanded child messages.
        let prefix = "";
        if (hasExpandedMergeForwardChildren) {
          const senderLabel = await buildMessageSenderLabel({
            cfg,
            rawContent,
            client,
            accountId: account.accountId,
            sender: item.sender,
          });
          if (senderLabel) {
            prefix = `[${senderLabel}] `;
          }
        }
        parsedContents.push(prefix + content.trim());
      }
    }

    const combinedContent = hasExpandedMergeForwardChildren
      ? parsedContents.join("\n\n---\n\n")
      : (parsedContents[0] ?? "");
    const firstItem = items[0];
    const senderName = firstItem
      ? await buildMessageSenderLabel({
          cfg,
          rawContent: firstItem.body?.content ?? "",
          client,
          accountId: account.accountId,
          sender: firstItem.sender,
        })
      : undefined;

    return {
      messageId: firstItem?.message_id ?? messageId,
      chatId: firstItem?.chat_id ?? "",
      senderId: firstItem?.sender?.id,
      senderOpenId: firstItem?.sender?.id_type === "open_id" ? firstItem?.sender?.id : undefined,
      senderName,
      content: combinedContent,
      contentType: firstItem?.msg_type ?? "text",
      createTime: firstItem?.create_time ? parseInt(firstItem.create_time, 10) : undefined,
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
  /** Mention target users */
  mentions?: MentionTarget[];
  /** Account ID (optional, uses default if not specified) */
  accountId?: string;
};

function buildFeishuPostMessagePayload(params: { messageText: string }): {
  content: string;
  msgType: string;
} {
  const { messageText } = params;
  return {
    content: JSON.stringify({
      zh_cn: {
        content: [
          [
            {
              tag: "md",
              text: messageText,
            },
          ],
        ],
      },
    }),
    msgType: "post",
  };
}

export async function sendMessageFeishu(params: SendFeishuMessageParams): Promise<FeishuSendResult> {
  const { cfg, to, text, replyToMessageId, mentions, accountId } = params;
  const account = resolveFeishuAccount({ cfg, accountId });
  if (!account.configured) {
    throw new Error(`Feishu account "${account.accountId}" not configured`);
  }

  const client = createFeishuClient(account);
  const receiveId = normalizeFeishuTarget(to);
  if (!receiveId) {
    throw new Error(`Invalid Feishu target: ${to}`);
  }

  const receiveIdType = resolveReceiveIdType(receiveId);
  const tableMode = getFeishuRuntime().channel.text.resolveMarkdownTableMode({
    cfg,
    channel: "feishu",
  });

  // Build message content (with @mention support)
  let rawText = text ?? "";
  if (mentions && mentions.length > 0) {
    rawText = buildMentionedMessage(mentions, rawText);
  }
  const messageText = normalizeFeishuMarkdownLinks(
    getFeishuRuntime().channel.text.convertMarkdownTables(rawText, tableMode),
  );

  const { content, msgType } = buildFeishuPostMessagePayload({ messageText });

  if (replyToMessageId) {
    const response = await client.im.message.reply({
      path: { message_id: replyToMessageId },
      data: {
        content,
        msg_type: msgType,
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
      msg_type: msgType,
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
  accountId?: string;
};

export async function sendCardFeishu(params: SendFeishuCardParams): Promise<FeishuSendResult> {
  const { cfg, to, card, replyToMessageId, accountId } = params;
  const account = resolveFeishuAccount({ cfg, accountId });
  if (!account.configured) {
    throw new Error(`Feishu account "${account.accountId}" not configured`);
  }

  const client = createFeishuClient(account);
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
  accountId?: string;
}): Promise<void> {
  const { cfg, messageId, card, accountId } = params;
  const account = resolveFeishuAccount({ cfg, accountId });
  if (!account.configured) {
    throw new Error(`Feishu account "${account.accountId}" not configured`);
  }

  const client = createFeishuClient(account);
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
 * Uses schema 2.0 format for proper markdown rendering.
 */
export function buildMarkdownCard(text: string): Record<string, unknown> {
  return {
    schema: "2.0",
    config: {
      wide_screen_mode: true,
    },
    body: {
      elements: [
        {
          tag: "markdown",
          content: text,
        },
      ],
    },
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
  /** Mention target users */
  mentions?: MentionTarget[];
  accountId?: string;
}): Promise<FeishuSendResult> {
  const { cfg, to, text, replyToMessageId, mentions, accountId } = params;
  // Build message content (with @mention support)
  let cardText = text;
  if (mentions && mentions.length > 0) {
    cardText = buildMentionedCardContent(mentions, text);
  }
  cardText = normalizeFeishuMarkdownLinks(cardText);
  const card = buildMarkdownCard(cardText);
  return sendCardFeishu({ cfg, to, card, replyToMessageId, accountId });
}

/**
 * Edit an existing text message.
 * Note: Feishu only allows editing messages within 24 hours.
 */
export async function editMessageFeishu(params: {
  cfg: ClawdbotConfig;
  messageId: string;
  text: string;
  accountId?: string;
}): Promise<void> {
  const { cfg, messageId, text, accountId } = params;
  const account = resolveFeishuAccount({ cfg, accountId });
  if (!account.configured) {
    throw new Error(`Feishu account "${account.accountId}" not configured`);
  }

  const client = createFeishuClient(account);
  const tableMode = getFeishuRuntime().channel.text.resolveMarkdownTableMode({
    cfg,
    channel: "feishu",
  });
  const messageText = normalizeFeishuMarkdownLinks(
    getFeishuRuntime().channel.text.convertMarkdownTables(text ?? "", tableMode),
  );

  const { content, msgType } = buildFeishuPostMessagePayload({ messageText });

  const response = await client.im.message.update({
    path: { message_id: messageId },
    data: {
      msg_type: msgType,
      content,
    },
  });

  if (response.code !== 0) {
    throw new Error(`Feishu message edit failed: ${response.msg || `code ${response.code}`}`);
  }
}
