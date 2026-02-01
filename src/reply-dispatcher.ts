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
import {
  addTypingIndicator,
  removeTypingIndicator,
  type TypingIndicatorState,
} from "./typing.js";
import { createFeishuDraftStream, type FeishuDraftStream } from "./draft-stream.js";

/**
 * Detect if text contains markdown elements that benefit from card rendering.
 * Used by auto render mode.
 */
function shouldUseCard(text: string): boolean {
  // Code blocks (fenced)
  if (/```[\s\S]*?```/.test(text)) return true;
  // Tables (at least header + separator row with |)
  if (/\|.+\|[\r\n]+\|[-:| ]+\|/.test(text)) return true;
  return false;
}

export type CreateFeishuReplyDispatcherParams = {
  cfg: ClawdbotConfig;
  agentId: string;
  runtime: RuntimeEnv;
  chatId: string;
  replyToMessageId?: string;
};

/**
 * Resolve block streaming configuration for Feishu.
 * Returns undefined if streaming is disabled.
 */
function resolveFeishuStreamingConfig(cfg: ClawdbotConfig): {
  enabled: boolean;
  mode: "partial" | "block";
} {
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;

  // Check if blockStreaming is explicitly disabled
  if (feishuCfg?.blockStreaming === false) {
    return { enabled: false, mode: "block" };
  }

  // Default: enabled with block mode
  return { enabled: true, mode: "block" };
}

export function createFeishuReplyDispatcher(params: CreateFeishuReplyDispatcherParams) {
  const core = getFeishuRuntime();
  const { cfg, agentId, chatId, replyToMessageId } = params;

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

  // Block streaming setup
  const streamingConfig = resolveFeishuStreamingConfig(cfg);
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  const renderMode = feishuCfg?.renderMode ?? "auto";

  // Only enable streaming for card mode (markdown rendering looks better while streaming)
  const canStreamDraft = streamingConfig.enabled && renderMode !== "raw";

  let draftStream: FeishuDraftStream | undefined;
  let lastPartialText = "";

  // Create draft stream if streaming is enabled
  if (canStreamDraft) {
    draftStream = createFeishuDraftStream({
      cfg,
      chatId,
      replyToMessageId,
      maxChars: 25000, // Feishu card limit
      throttleMs: 250, // 5 QPS = 200ms minimum
      log: (msg) => params.runtime.log?.(msg),
      warn: (msg) => params.runtime.log?.(msg),
    });
  }

  /**
   * Handle partial reply updates (streaming tokens).
   * Updates the draft card with accumulated text.
   */
  const onPartialReply = draftStream
    ? (payload: ReplyPayload) => {
        const text = payload.text;
        if (!text || text === lastPartialText) return;
        lastPartialText = text;
        draftStream?.update(text);
      }
    : undefined;

  /**
   * Flush draft stream and stop it.
   * Called when final response is ready.
   */
  const flushDraft = async (): Promise<void> => {
    if (!draftStream) return;
    await draftStream.flush();
    draftStream.stop();
  };

  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      responsePrefix: prefixContext.responsePrefix,
      responsePrefixContextProvider: prefixContext.responsePrefixContextProvider,
      humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, agentId),
      onReplyStart: typingCallbacks.onReplyStart,
      deliver: async (payload: ReplyPayload, info) => {
        params.runtime.log?.(`feishu deliver called: text=${payload.text?.slice(0, 100)}`);
        const text = payload.text ?? "";
        if (!text.trim()) {
          params.runtime.log?.(`feishu deliver: empty text, skipping`);
          return;
        }

        // If we have an active draft stream and this is the final message,
        // just ensure the draft is flushed (the card already contains the content)
        if (draftStream && info?.kind === "final") {
          const streamMessageId = draftStream.getMessageId();
          if (streamMessageId) {
            // Draft already sent via streaming - just flush final content
            await flushDraft();
            params.runtime.log?.(`feishu deliver: final content flushed to streaming card`);
            return;
          }
        }

        // Stop draft stream if running (for non-streamed or additional messages)
        if (draftStream) {
          draftStream.stop();
        }

        // Determine if we should use card for this message
        const useCard =
          renderMode === "card" || (renderMode === "auto" && shouldUseCard(text));

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
            });
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
            });
          }
        }
      },
      onError: (err, info) => {
        params.runtime.error?.(`feishu ${info.kind} reply failed: ${String(err)}`);
        draftStream?.stop();
        typingCallbacks.onIdle?.();
      },
      onIdle: () => {
        draftStream?.stop();
        typingCallbacks.onIdle?.();
      },
    });

  return {
    dispatcher,
    replyOptions: {
      ...replyOptions,
      onModelSelected: prefixContext.onModelSelected,
      // Add partial reply handler for streaming
      onPartialReply,
      // Disable block streaming in the underlying dispatcher since we handle it ourselves
      disableBlockStreaming: Boolean(draftStream),
    },
    markDispatchIdle,
  };
}
