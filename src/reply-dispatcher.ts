import {
  createReplyPrefixContext,
  createTypingCallbacks,
  logTypingFailure,
  type ClawdbotConfig,
  type RuntimeEnv,
  type ReplyPayload,
} from "openclaw/plugin-sdk";
import { getFeishuRuntime } from "./runtime.js";
import { sendMessageFeishu, sendMarkdownCardFeishu } from "./send.js";
import type { FeishuConfig } from "./types.js";
import type { MentionTarget } from "./mention.js";
import {
  addTypingIndicator,
  removeTypingIndicator,
  type TypingIndicatorState,
} from "./typing.js";

/**
 * Detect if text contains markdown elements that benefit from card rendering.
 * Used by auto render mode.
 * Use card if text contains any of the supported markdown elements.
 */
function shouldUseCard(text: string): boolean {
  const trimmedText = text.trim();
  if (!trimmedText) return false;
  
  // All detection patterns - return true if any pattern matches
  const patterns = [
    // Code blocks
    /```[\s\S]*?```/,                    // Fenced code blocks
    /^\s{4,}|\t/,                        // Indented code blocks
    
    // Tables
    /\|[^\n]*\|[^\n]*[\r\n]+\|[-:| \t]+\|/,
    
    // Color tags (any paired <font> tags)
    /<font[^>]*>[\s\S]*?<\/font>/i,
    
    // Horizontal rules
    /^---*$|^___*$|^\*\*\**$/m,
    
    // Lists
    /^[\-\*\+]\s+.+/m,                    // Unordered lists
    /^\d+\.\s+.+/m,                       // Ordered lists
    
    // Text formatting
    /\*\*[^*]+\*\*/,                      // Bold
    /\*[^*]+\*/,                          // Italic
    /~~[^~]+~~/,                          // Strikethrough
  ];
  
  return patterns.some(pattern => pattern.test(trimmedText));
}

export type CreateFeishuReplyDispatcherParams = {
  cfg: ClawdbotConfig;
  agentId: string;
  runtime: RuntimeEnv;
  chatId: string;
  replyToMessageId?: string;
  /** Mention targets, will be auto-included in replies */
  mentionTargets?: MentionTarget[];
};

export function createFeishuReplyDispatcher(params: CreateFeishuReplyDispatcherParams) {
  const core = getFeishuRuntime();
  const { cfg, agentId, chatId, replyToMessageId, mentionTargets } = params;

  const prefixContext = createReplyPrefixContext({
    cfg,
    agentId,
  });

  // Feishu doesn't have a native typing indicator API.
  // We use message reactions as a typing indicator substitute.
  let typingState: TypingIndicatorState | null = null;

  const typingCallbacks = createTypingCallbacks({
    start: async () => {
      if (!replyToMessageId) return;
      typingState = await addTypingIndicator({ cfg, messageId: replyToMessageId });
      params.runtime.log?.(`feishu: added typing indicator reaction`);
    },
    stop: async () => {
      if (!typingState) return;
      await removeTypingIndicator({ cfg, state: typingState });
      typingState = null;
      params.runtime.log?.(`feishu: removed typing indicator reaction`);
    },
    onStartError: (err) => {
      logTypingFailure({
        log: (message) => params.runtime.log?.(message),
        channel: "feishu",
        action: "start",
        error: err,
      });
    },
    onStopError: (err) => {
      logTypingFailure({
        log: (message) => params.runtime.log?.(message),
        channel: "feishu",
        action: "stop",
        error: err,
      });
    },
  });

  const textChunkLimit = core.channel.text.resolveTextChunkLimit({
    cfg,
    channel: "feishu",
    defaultLimit: 4000,
  });
  const chunkMode = core.channel.text.resolveChunkMode(cfg, "feishu");
  const tableMode = core.channel.text.resolveMarkdownTableMode({
    cfg,
    channel: "feishu",
  });

  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      responsePrefix: prefixContext.responsePrefix,
      responsePrefixContextProvider: prefixContext.responsePrefixContextProvider,
      humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, agentId),
      onReplyStart: typingCallbacks.onReplyStart,
      deliver: async (payload: ReplyPayload) => {
        params.runtime.log?.(`feishu deliver called: text=${payload.text?.slice(0, 100)}`);
        const text = payload.text ?? "";
        if (!text.trim()) {
          params.runtime.log?.(`feishu deliver: empty text, skipping`);
          return;
        }

        // Check render mode: auto (default), raw, or card
        const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
        const renderMode = feishuCfg?.renderMode ?? "auto";

        // Determine if we should use card for this message
        const useCard =
          renderMode === "card" || (renderMode === "auto" && shouldUseCard(text));

        // Only include @mentions in the first chunk (avoid duplicate @s)
        let isFirstChunk = true;

        if (useCard) {
          // Card mode: send as interactive card with markdown rendering
          const chunks = core.channel.text.chunkTextWithMode(text, textChunkLimit, chunkMode);
          params.runtime.log?.(`feishu deliver: sending ${chunks.length} card chunks to ${chatId}`);
          for (const chunk of chunks) {
            await sendMarkdownCardFeishu({
              cfg,
              to: chatId,
              text: chunk,
              replyToMessageId,
              mentions: isFirstChunk ? mentionTargets : undefined,
            });
            isFirstChunk = false;
          }
        } else {
          // Raw mode: send as plain text with table conversion
          const converted = core.channel.text.convertMarkdownTables(text, tableMode);
          const chunks = core.channel.text.chunkTextWithMode(converted, textChunkLimit, chunkMode);
          params.runtime.log?.(`feishu deliver: sending ${chunks.length} text chunks to ${chatId}`);
          for (const chunk of chunks) {
            await sendMessageFeishu({
              cfg,
              to: chatId,
              text: chunk,
              replyToMessageId,
              mentions: isFirstChunk ? mentionTargets : undefined,
            });
            isFirstChunk = false;
          }
        }
      },
      onError: (err, info) => {
        params.runtime.error?.(`feishu ${info.kind} reply failed: ${String(err)}`);
        typingCallbacks.onIdle?.();
      },
      onIdle: typingCallbacks.onIdle,
    });

  return {
    dispatcher,
    replyOptions: {
      ...replyOptions,
      onModelSelected: prefixContext.onModelSelected,
    },
    markDispatchIdle,
  };
}
