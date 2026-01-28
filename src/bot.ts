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
import { downloadMessageResourceFeishu } from "./media.js";
import {
  resolveFeishuGroupConfig,
  resolveFeishuReplyPolicy,
  resolveFeishuAllowlistMatch,
  isFeishuGroupAllowed,
} from "./policy.js";
import { createFeishuReplyDispatcher } from "./reply-dispatcher.js";
import { getMessageFeishu } from "./send.js";

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
    // For media messages, keep the JSON so we can extract keys later.
    return content;
  } catch {
    return content;
  }
}

function tryParseJson(content: string): any | null {
  try {
    return JSON.parse(content);
  } catch {
    return null;
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

  // Optionally hydrate inbound media (images/files) from Feishu.
  // This converts Feishu's {image_key: ...} into a local MediaPath for Clawdbot.
  let inboundMediaPath: string | undefined;
  let inboundMediaType: string | undefined;

  if (feishuCfg?.downloadInboundMedia) {
    // Feishu images can arrive as msg_type="image" or embedded in msg_type="post".
    // post content example: { title: "", content: [[{tag:"img", image_key:"..."}], [{tag:"text", text:"..."}]] }
    log(`feishu: inbound media hydrate enabled; msg_type=${ctx.contentType} preview=${String(ctx.content).slice(0, 160)}`);
    const parsed = tryParseJson(ctx.content);

    let imageKeys: string[] = [];
    let extractedText: string | undefined;

    if (ctx.contentType === "image") {
      const imageKey = parsed?.image_key as string | undefined;
      if (imageKey) imageKeys = [imageKey];
    } else if (ctx.contentType === "file") {
      // File messages carry file_key + file_name. Some users send images as files.
      const fileKey = parsed?.file_key as string | undefined;
      const fileName = parsed?.file_name as string | undefined;
      if (fileKey) {
        imageKeys = [fileKey];
      }
      if (fileName) {
        extractedText = fileName;
      }
    } else if (ctx.contentType === "post") {
      const contentBlocks = parsed?.content;
      if (Array.isArray(contentBlocks)) {
        for (const row of contentBlocks) {
          if (!Array.isArray(row)) continue;
          for (const cell of row) {
            if (!cell || typeof cell !== "object") continue;
            if (cell.tag === "img" && typeof cell.image_key === "string") {
              imageKeys.push(cell.image_key);
            }
            if (cell.tag === "text" && typeof cell.text === "string") {
              extractedText = (extractedText ? `${extractedText}\n${cell.text}` : cell.text);
            }
          }
        }
      }
    }

    log(`feishu: extracted imageKeys=${imageKeys.length} textLen=${extractedText?.length ?? 0}`);

    const imageKey = imageKeys[0];
    if (imageKey) {
      try {
        const isFileMessage = ctx.contentType === "file";
        const note = extractedText?.trim() ? extractedText.trim() : "";

        const downloaded = await downloadMessageResourceFeishu({
          cfg,
          messageId: ctx.messageId,
          fileKey: imageKey,
          type: isFileMessage ? "file" : "image",
          fileNameHint: note ? `${ctx.messageId}_${note}` : `${ctx.messageId}_${imageKey}`,
        });
        inboundMediaPath = downloaded.path;
        inboundMediaType = downloaded.contentType;

        const looksLikeImage =
          (downloaded.contentType ? downloaded.contentType.startsWith("image/") : false) ||
          (note ? /\.(png|jpe?g|gif|webp|bmp|tiff)$/i.test(note) : false);

        ctx.content = `${note ? note + "\n" : ""}<media:${looksLikeImage ? "image" : "attachment"}>`;
        if (imageKeys.length > 1) {
          ctx.content += `\n(附：本条消息包含 ${imageKeys.length} 个媒体资源，目前只取第 1 个)`;
        }
      } catch (err) {
        log(`feishu: failed to download inbound media (${imageKey}): ${String(err)}`);
      }
    }
  }

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

    // Build message body with quoted content if available
    let messageBody = ctx.content;
    if (quotedContent) {
      messageBody = `[Replying to: "${quotedContent}"]\n\n${ctx.content}`;
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
      RawBody: ctx.content,
      CommandBody: ctx.content,
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

      ...(inboundMediaPath
        ? {
            MediaPath: inboundMediaPath,
            MediaType: inboundMediaType,
            MediaUrl: inboundMediaPath,
          }
        : {}),
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
