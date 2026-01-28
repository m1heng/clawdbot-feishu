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
import { getMessageFeishu } from "./send.js";
import { downloadImageFeishu, downloadFileFeishu, downloadAudioFeishu, downloadMessageResourceFeishu } from "./media.js";

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
    // Return raw JSON for non-text messages (will be processed by parseMessageContentAsync)
    return content;
  } catch {
    return content;
  }
}

/**
 * Parse message content with async media download support.
 * Downloads images/files and returns local file paths for AI to process.
 */
async function parseMessageContentAsync(params: {
  cfg: ClawdbotConfig;
  content: string;
  messageType: string;
  messageId: string;
  log?: (msg: string) => void;
}): Promise<string> {
  const { cfg, content, messageType, messageId, log } = params;
  const logFn = log ?? console.log;
  
  try {
    const parsed = JSON.parse(content);
    
    switch (messageType) {
      case "text":
        return parsed.text || "";
        
      case "image": {
        const imageKey = parsed.image_key;
        if (!imageKey) {
          return "[图片: 无法获取 image_key]";
        }
        try {
          logFn(`feishu: downloading image ${imageKey}`);
          const result = await downloadImageFeishu({ cfg, imageKey });
          logFn(`feishu: image saved to ${result.filePath} (${result.size} bytes)`);
          return `[用户发送了图片: ${result.filePath}]`;
        } catch (err) {
          logFn(`feishu: failed to download image: ${String(err)}`);
          return `[图片下载失败: ${imageKey}]`;
        }
      }
      
      case "file": {
        const fileKey = parsed.file_key;
        const fileName = parsed.file_name;
        if (!fileKey) {
          return "[文件: 无法获取 file_key]";
        }
        try {
          logFn(`feishu: downloading file ${fileName || fileKey}`);
          const result = await downloadFileFeishu({ 
            cfg, 
            messageId, 
            fileKey, 
            fileName,
          });
          logFn(`feishu: file saved to ${result.filePath} (${result.size} bytes)`);
          return `[用户发送了文件: ${result.filePath}]`;
        } catch (err) {
          logFn(`feishu: failed to download file: ${String(err)}`);
          return `[文件下载失败: ${fileName || fileKey}]`;
        }
      }
      
      case "audio": {
        const fileKey = parsed.file_key;
        if (!fileKey) {
          return "[语音: 无法获取 file_key]";
        }
        try {
          logFn(`feishu: downloading audio ${fileKey}`);
          const result = await downloadAudioFeishu({ cfg, messageId, fileKey });
          logFn(`feishu: audio saved to ${result.filePath} (${result.size} bytes)`);
          return `[用户发送了语音消息: ${result.filePath}]`;
        } catch (err) {
          logFn(`feishu: failed to download audio: ${String(err)}`);
          return `[语音下载失败: ${fileKey}]`;
        }
      }
      
      case "media": {
        // Media type contains both image and file info
        const imageKey = parsed.image_key;
        const fileKey = parsed.file_key;
        const fileName = parsed.file_name;
        
        if (imageKey) {
          try {
            const result = await downloadImageFeishu({ cfg, imageKey });
            return `[用户发送了媒体文件: ${result.filePath}]`;
          } catch (err) {
            logFn(`feishu: failed to download media image: ${String(err)}`);
          }
        }
        
        if (fileKey) {
          try {
            const result = await downloadFileFeishu({ cfg, messageId, fileKey, fileName });
            return `[用户发送了媒体文件: ${result.filePath}]`;
          } catch (err) {
            logFn(`feishu: failed to download media file: ${String(err)}`);
          }
        }
        
        return `[媒体消息: ${content}]`;
      }
      
      case "sticker":
        return `[表情包: ${parsed.file_key || "unknown"}]`;
        
      case "share_chat":
        return `[分享群聊: ${parsed.chat_id || "unknown"}]`;
        
      case "share_user":
        return `[分享用户: ${parsed.user_id || "unknown"}]`;
        
      case "post":
        // Rich text post - extract text content and download embedded images
        try {
          const title = parsed.title || "";
          const contentBlocks = parsed.content || [];
          let textContent = title ? `${title}\n\n` : "";
          const downloadedImages: string[] = [];
          
          for (const paragraph of contentBlocks) {
            if (Array.isArray(paragraph)) {
              for (const element of paragraph) {
                if (element.tag === "text") {
                  textContent += element.text || "";
                } else if (element.tag === "a") {
                  textContent += element.text || element.href || "";
                } else if (element.tag === "at") {
                  textContent += `@${element.user_name || element.user_id || ""}`;
                } else if (element.tag === "img" && element.image_key) {
                  // Download embedded image using message resource API
                  try {
                    logFn(`feishu: downloading embedded image ${element.image_key} from message ${messageId}`);
                    const result = await downloadMessageResourceFeishu({ 
                      cfg, 
                      messageId, 
                      fileKey: element.image_key,
                      resourceType: "image",
                    });
                    downloadedImages.push(result.filePath);
                    logFn(`feishu: embedded image saved to ${result.filePath}`);
                  } catch (err) {
                    logFn(`feishu: failed to download embedded image: ${String(err)}`);
                    textContent += `[图片下载失败: ${element.image_key}]`;
                  }
                }
              }
              textContent += "\n";
            }
          }
          
          // Combine text content with downloaded image paths
          let result = textContent.trim() || "[富文本消息]";
          if (downloadedImages.length > 0) {
            result += "\n\n[用户发送的图片:\n" + downloadedImages.map(p => `  - ${p}`).join("\n") + "\n]";
          }
          
          return result;
        } catch {
          return "[富文本消息]";
        }
        
      default:
        return `[${messageType}消息: ${content}]`;
    }
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

    // Parse message content with async media download support
    // For non-text messages, this will download files and return local paths
    let messageBody: string;
    if (ctx.contentType !== "text") {
      messageBody = await parseMessageContentAsync({
        cfg,
        content: event.message.content,
        messageType: ctx.contentType,
        messageId: ctx.messageId,
        log,
      });
      // Strip bot mention from parsed content if needed
      messageBody = stripBotMention(messageBody, event.message.mentions);
    } else {
      messageBody = ctx.content;
    }

    // Add quoted content if available
    if (quotedContent) {
      messageBody = `[Replying to: "${quotedContent}"]\n\n${messageBody}`;
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
