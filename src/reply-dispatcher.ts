import {
  createReplyPrefixContext,
  createTypingCallbacks,
  logTypingFailure,
  type ClawdbotConfig,
  type RuntimeEnv,
  type ReplyPayload,
} from "clawdbot/plugin-sdk";
import { getFeishuRuntime } from "./runtime.js";
import { sendMessageFeishu, sendCardFeishu, updateCardFeishu, createSimpleTextCard } from "./send.js";
import {
  addTypingIndicator,
  removeTypingIndicator,
  type TypingIndicatorState,
} from "./typing.js";

// Feishu rate limits are strict (5 QPS), so we throttle updates.
// We target ~2-3 updates per second to be safe and smooth.
const STREAM_UPDATE_INTERVAL_MS = 400;

class FeishuStream {
  private messageId: string | null = null;
  private lastContent = "";
  private lastUpdateTime = 0;
  private pendingUpdate: NodeJS.Timeout | null = null;
  private isFinalized = false;
  private initializationPromise: Promise<void> | null = null;

  constructor(
    private ctx: {
      cfg: ClawdbotConfig;
      chatId: string;
      replyToMessageId?: string;
      runtime: RuntimeEnv;
    },
  ) { }

  async update(content: string, isFinal = false): Promise<void> {
    if (this.isFinalized) return;
    if (content === this.lastContent) return;

    // If we haven't sent the first message yet, send it immediately
    if (!this.messageId) {
      // If we are already creating the message, wait for it
      if (this.initializationPromise) {
        await this.initializationPromise;
        // After waiting, if we have a messageId, proceed to normal update flow
        if (this.messageId) {
          // Fall through to update logic below
        } else {
          // Initialization failed or something weird happened
          return;
        }
      } else {
        // Start initialization
        this.ctx.runtime.log?.(`feishu stream: initializing card with "${content.slice(0, 20)}..."`);

        this.initializationPromise = (async () => {
          try {
            // Use Card with streaming_mode: true
            const card = createSimpleTextCard(content, true /* streaming */);

            const result = await sendCardFeishu({
              cfg: this.ctx.cfg,
              to: this.ctx.chatId,
              card,
              replyToMessageId: this.ctx.replyToMessageId,
            });
            this.messageId = result.messageId;
            this.lastContent = content;
            this.lastUpdateTime = Date.now();
            this.ctx.runtime.log?.(`feishu stream: initialized card messageId=${this.messageId}`);
          } catch (err) {
            this.ctx.runtime.error?.(`feishu stream card create failed: ${String(err)}`);
          } finally {
            this.initializationPromise = null;
          }
        })();

        await this.initializationPromise;
        return;
      }
    }

    // Schedule or execute update
    const now = Date.now();
    const timeSinceLast = now - this.lastUpdateTime;

    if (isFinal || timeSinceLast >= STREAM_UPDATE_INTERVAL_MS) {
      await this.performUpdate(content);
    } else if (!this.pendingUpdate) {
      this.pendingUpdate = setTimeout(() => {
        this.pendingUpdate = null;
        this.performUpdate(content).catch(() => { });
      }, STREAM_UPDATE_INTERVAL_MS - timeSinceLast);
    }
  }

  private async performUpdate(content: string) {
    if (!this.messageId || this.isFinalized) return;
    try {
      // For updates, we keep streaming_mode: true until finalized
      const card = createSimpleTextCard(content, true);

      await updateCardFeishu({
        cfg: this.ctx.cfg,
        messageId: this.messageId,
        card,
      });
      this.lastContent = content;
      this.lastUpdateTime = Date.now();
    } catch (err) {
      this.ctx.runtime.log?.(`feishu stream update failed: ${String(err)}`);
    }
  }

  async finalize(content: string) {
    if (this.isFinalized) return;

    if (this.pendingUpdate) {
      clearTimeout(this.pendingUpdate);
      this.pendingUpdate = null;
    }

    // Use streaming_mode: false to signal completion
    if (this.messageId) {
      try {
        const card = createSimpleTextCard(content, false /* streaming=false means done */);
        await updateCardFeishu({
          cfg: this.ctx.cfg,
          messageId: this.messageId,
          card,
        });
        this.isFinalized = true;
      } catch (err) {
        this.ctx.runtime.error?.(`feishu stream finalize failed: ${String(err)}`);
      }
    }
  }

  getMessageId(): string | null {
    return this.messageId;
  }
}

export type CreateFeishuReplyDispatcherParams = {
  cfg: ClawdbotConfig;
  agentId: string;
  runtime: RuntimeEnv;
  chatId: string;
  replyToMessageId?: string;
};

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

  // Track active stream for the current block
  let currentStream: FeishuStream | null = null;

  const typingCallbacks = createTypingCallbacks({
    start: async () => {
      // If we are streaming, we don't need typing indicator as text appears
      if (currentStream?.getMessageId()) return;

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
      // Squelch errors
    },
    onStopError: (err) => {
      // Squelch errors
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
          return;
        }

        const converted = core.channel.text.convertMarkdownTables(text, tableMode);

        // If we have an active stream, finalize it with the raw content (skipping table conversion)
        if (currentStream) {
          await currentStream.finalize(text);
          currentStream = null;
          return;
        }

        // Fallback or fragmented message handling
        const chunks = core.channel.text.chunkTextWithMode(converted, textChunkLimit, chunkMode);

        params.runtime.log?.(`feishu deliver: sending ${chunks.length} chunks to ${chatId}`);
        for (const chunk of chunks) {
          await sendMessageFeishu({
            cfg,
            to: chatId,
            text: chunk,
            replyToMessageId,
          });
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
      onPartialReply: async (payload: ReplyPayload) => {
        const text = payload.text ?? "";
        if (!text) return;

        if (!currentStream) {
          currentStream = new FeishuStream({
            cfg,
            chatId,
            replyToMessageId,
            runtime: params.runtime,
          });
          // Stop specific typing indicator if we start streaming text
          // (though typingCallbacks.onIdle will be called eventually)
          if (typingState) {
            await typingCallbacks.onIdle?.();
          }
        }

        // const converted = core.channel.text.convertMarkdownTables(text, tableMode);
        // We pass raw text to allow Feishu to handle markdown (lark_md)
        await currentStream.update(text);
      }
    },
    markDispatchIdle,
  };
}
