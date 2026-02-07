import {
  createReplyPrefixContext,
  createTypingCallbacks,
  logTypingFailure,
  type ClawdbotConfig,
  type RuntimeEnv,
  type ReplyPayload,
} from "openclaw/plugin-sdk";
import { getFeishuRuntime } from "./runtime.js";
import { createFeishuRenderer } from "./renderers/feishu-renderer.js";
import type { MentionTarget } from "./mention.js";
import { resolveFeishuAccount } from "./accounts.js";
import {
  addTypingIndicator,
  removeTypingIndicator,
  type TypingIndicatorState,
} from "./typing.js";

export type CreateFeishuReplyDispatcherParams = {
  cfg: ClawdbotConfig;
  agentId: string;
  runtime: RuntimeEnv;
  chatId: string;
  replyToMessageId?: string;
  /** Mention targets, will be auto-included in replies */
  mentionTargets?: MentionTarget[];
  /** Account ID for multi-account support */
  accountId?: string;
};

export function createFeishuReplyDispatcher(params: CreateFeishuReplyDispatcherParams) {
  const core = getFeishuRuntime();
  const { cfg, agentId, chatId, replyToMessageId, mentionTargets, accountId } = params;

  // Resolve account for config access
  const account = resolveFeishuAccount({ cfg, accountId });

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
      typingState = await addTypingIndicator({ cfg, messageId: replyToMessageId, accountId });
      params.runtime.log?.(`feishu[${account.accountId}]: added typing indicator reaction`);
    },
    stop: async () => {
      if (!typingState) return;
      await removeTypingIndicator({ cfg, state: typingState, accountId });
      typingState = null;
      params.runtime.log?.(`feishu[${account.accountId}]: removed typing indicator reaction`);
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

  const renderer = createFeishuRenderer({
    cfg,
    agentId,
    runtime: params.runtime,
    chatId,
    replyToMessageId,
    mentionTargets,
    accountId,
    accountConfig: account.config,
  });

  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      responsePrefix: prefixContext.responsePrefix,
      responsePrefixContextProvider: prefixContext.responsePrefixContextProvider,
      humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, agentId),
      onReplyStart: typingCallbacks.onReplyStart,
      deliver: async (payload: ReplyPayload) => {
        await renderer.deliver(payload);
      },
      onError: (err, info) => {
        params.runtime.error?.(`feishu[${account.accountId}] ${info.kind} reply failed: ${String(err)}`);
        void renderer.onError?.(err);
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
    markDispatchIdle: () => {
      void renderer.finalize?.();
      markDispatchIdle();
    },
  };
}
