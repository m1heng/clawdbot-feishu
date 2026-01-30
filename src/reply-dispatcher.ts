import {
  createReplyPrefixContext,
  createTypingCallbacks,
  logTypingFailure,
  type ClawdbotConfig,
  type RuntimeEnv,
  type ReplyPayload,
} from "openclaw/plugin-sdk";
import { getFeishuRuntime } from "./runtime.js";
import { sendMessageFeishu, sendCardFeishu } from "./send.js";
import {
  addTypingIndicator,
  removeTypingIndicator,
  type TypingIndicatorState,
} from "./typing.js";
import type { FeishuConfig } from "./types.js";
import { buildFeishuInteractiveCard } from "./formatter.js";

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

  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  
  // Robust check for interactive cards capability
  const caps = feishuCfg?.capabilities;
  const useCards = Array.isArray(caps) 
    ? caps.includes("interactiveCards") 
    : !!(caps as any)?.interactiveCards;

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
        params.runtime.log?.(`feishu deliver called: text=${payload.text?.slice(0, 100)} (useCards=${useCards})`);
        const text = payload.text ?? "";
        if (!text.trim()) {
          params.runtime.log?.(`feishu deliver: empty text, skipping`);
          return;
        }

        const converted = core.channel.text.convertMarkdownTables(text, tableMode);

        if (useCards) {
          const cardData = buildFeishuInteractiveCard({
            text: converted,
            title: (feishuCfg?.card?.header?.title as any)?.content,
            template: feishuCfg?.card?.header?.template,
          });

          await sendCardFeishu({
            cfg,
            to: chatId,
            card: cardData,
            replyToMessageId,
          });
          return;
        }

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
    },
    markDispatchIdle,
  };
}
