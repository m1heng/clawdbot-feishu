import type { ClawdbotConfig, RuntimeEnv, ReplyPayload } from "openclaw/plugin-sdk";
import { getFeishuRuntime } from "../runtime.js";
import {
  sendMessageFeishu,
  sendMarkdownCardFeishu,
  sendCardFeishu,
  updateCardFeishu,
} from "../send.js";
import type { FeishuConfig } from "../types.js";
import type { MentionTarget } from "../mention.js";
import { buildMentionedCardContent } from "../mention.js";
import {
  AgentRunTracker,
  AgentRunStatus,
  buildLarkCard,
  type AgentCoreMessage,
} from "./agent-card-view.js";

type FeishuRenderController = {
  deliver: (payload: ReplyPayload) => Promise<void>;
  finalize?: () => Promise<void>;
  onError?: (err: unknown) => Promise<void>;
};

type CreateFeishuRendererParams = {
  cfg: ClawdbotConfig;
  agentId: string;
  runtime: RuntimeEnv;
  chatId: string;
  replyToMessageId?: string;
  mentionTargets?: MentionTarget[];
  accountId?: string;
  accountConfig?: FeishuConfig;
};

function shouldUseCard(text: string): boolean {
  if (/```[\s\S]*?```/.test(text)) return true;
  if (/\|.+\|[\r\n]+\|[-:| ]+\|/.test(text)) return true;
  return false;
}

function mergeStreamText(prev: string, next: string): string {
  if (!prev) return next;
  if (!next) return prev;
  if (next.startsWith(prev)) return next;
  if (prev.startsWith(next)) return prev;
  return prev + next;
}

function applyMentions(mentions: MentionTarget[] | undefined, text: string): string {
  if (!mentions || mentions.length === 0) return text;
  return buildMentionedCardContent(mentions, text);
}

function extractAgentMessages(payload: ReplyPayload): AgentCoreMessage[] | null {
  const raw = payload as unknown as {
    messages?: AgentCoreMessage[];
    meta?: { messages?: AgentCoreMessage[]; agentMessages?: AgentCoreMessage[] };
    extra?: { messages?: AgentCoreMessage[] };
    context?: { messages?: AgentCoreMessage[] };
    delta?: { messages?: AgentCoreMessage[] };
    events?: unknown[];
  };

  const candidates = [
    raw.messages,
    raw.meta?.agentMessages,
    raw.meta?.messages,
    raw.extra?.messages,
    raw.context?.messages,
    raw.delta?.messages,
  ];

  for (const list of candidates) {
    if (Array.isArray(list) && list.length > 0) {
      const hasRole = list.some((item) => item && typeof item === "object" && "role" in item);
      if (hasRole) {
        return list;
      }
    }
  }

  return null;
}

function extractVerboseEvents(payload: ReplyPayload): unknown[] | null {
  const raw = payload as unknown as {
    events?: unknown[];
    meta?: { events?: unknown[] };
    extra?: { events?: unknown[] };
    context?: { events?: unknown[] };
    delta?: { events?: unknown[] };
  };

  const candidates = [
    raw.events,
    raw.meta?.events,
    raw.extra?.events,
    raw.context?.events,
    raw.delta?.events,
  ];

  for (const list of candidates) {
    if (Array.isArray(list) && list.length > 0) {
      return list;
    }
  }

  return null;
}

function safeText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function applyVerboseEvent(params: {
  tracker: AgentRunTracker;
  event: unknown;
  assistantBuffer: { text: string };
}) {
  const { tracker, assistantBuffer } = params;
  const evt = params.event as { stream?: string; data?: any; event?: string; payload?: any };
  const stream = evt?.stream ?? evt?.event ?? evt?.payload?.stream;
  const data = evt?.data ?? evt?.payload?.data ?? evt?.payload ?? {};

  if (stream === "assistant") {
    const text = typeof data.text === "string" ? data.text : "";
    if (text) {
      tracker.setStatus(AgentRunStatus.Thinking);
      const prev = assistantBuffer.text;
      if (text.startsWith(prev)) {
        assistantBuffer.text = text;
      } else if (prev.startsWith(text)) {
        // ignore
      } else {
        assistantBuffer.text += text;
      }
      tracker.setDraftAnswer(assistantBuffer.text);
    }
    return;
  }

  if (stream === "tool") {
    const phase = typeof data.phase === "string" ? data.phase : "unknown";
    const name = typeof data.name === "string" ? data.name : "unknown-tool";
    const toolCallId = typeof data.toolCallId === "string" ? data.toolCallId : undefined;

    if (phase === "start") {
      tracker.setStatus(AgentRunStatus.ToolCalling);
      tracker.appendMessages([
        {
          role: "assistant",
          content: [
            { type: "tool-call", toolName: name, toolUseId: toolCallId, startedAt: Date.now() },
          ],
        },
      ]);
      return;
    }

    if (phase === "end" || phase === "result" || phase === "output" || phase === "error") {
      const isError = typeof data.isError === "boolean" ? data.isError : phase === "error";
      const meta = safeText(data.meta);
      const output = data.output !== undefined ? safeText(data.output) : "";
      const text = [output ? `输出: ${output}` : "", meta ? `备注: ${meta}` : "", isError ? "错误: true" : ""]
        .filter(Boolean)
        .join("\n");

      tracker.appendMessages([
        {
          role: "tool",
          toolUseId: toolCallId,
          content: [
            {
              type: "tool-result",
              toolUseId: toolCallId,
              text: text || (isError ? "工具执行失败" : "工具执行完成"),
              completedAt: Date.now(),
              durationMs: typeof data.durationMs === "number" ? data.durationMs : undefined,
              raw: data,
            },
          ],
        },
      ]);

      tracker.setStatus(isError ? AgentRunStatus.Error : AgentRunStatus.WaitingToolResult);
      return;
    }

    tracker.setStatus(AgentRunStatus.ToolCalling);
    return;
  }

  if (stream === "lifecycle") {
    const phase = typeof data.phase === "string" ? data.phase : "";
    if (phase === "start") {
      tracker.setStatus(AgentRunStatus.Thinking);
      return;
    }
    if (phase === "error") {
      tracker.setStatus(AgentRunStatus.Error);
      const err = typeof data.error === "string" ? data.error : "执行异常";
      tracker.setDraftAnswer(err);
      return;
    }
  }
}

function inferStatusFromMessages(messages: AgentCoreMessage[]): AgentRunStatus | null {
  let sawToolCall = false;
  let sawThinking = false;
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.content) {
      if (part.type === "tool-call") {
        sawToolCall = true;
      }
      if (part.type === "thinking") {
        sawThinking = true;
      }
    }
  }
  if (sawToolCall) return AgentRunStatus.ToolCalling;
  if (sawThinking) return AgentRunStatus.Thinking;
  return null;
}

function createCardUpdateController(params: {
  cfg: ClawdbotConfig;
  messageId: string;
  accountId?: string;
}) {
  const { cfg, messageId, accountId } = params;
  let pending: Record<string, unknown> | null = null;
  let inFlight: Promise<void> | null = null;
  let lastSentAt = 0;
  const MIN_INTERVAL_MS = 350;

  const flushOnce = async () => {
    if (!pending) return;
    const now = Date.now();
    const wait = Math.max(0, MIN_INTERVAL_MS - (now - lastSentAt));
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    const card = pending;
    pending = null;
    lastSentAt = Date.now();
    await updateCardFeishu({ cfg, messageId, card, accountId });
  };

  const kick = () => {
    if (inFlight) return;
    inFlight = (async () => {
      try {
        while (pending) {
          await flushOnce();
        }
      } finally {
        inFlight = null;
        if (pending) kick();
      }
    })();
  };

  return {
    schedule(card: Record<string, unknown>) {
      pending = card;
      kick();
    },
    async flush() {
      if (inFlight) await inFlight;
      if (pending) {
        await flushOnce();
      }
    },
  };
}

function createSimpleRenderer(params: CreateFeishuRendererParams): FeishuRenderController {
  const core = getFeishuRuntime();
  const { cfg, runtime, chatId, replyToMessageId, mentionTargets, accountId, accountConfig } = params;
  const cfgForText = accountConfig
    ? { ...cfg, channels: { ...cfg.channels, feishu: accountConfig } }
    : cfg;
  const textChunkLimit = core.channel.text.resolveTextChunkLimit({
    cfg: cfgForText,
    channel: "feishu",
    defaultLimit: 4000,
  });
  const chunkMode = core.channel.text.resolveChunkMode(cfgForText, "feishu");
  const tableMode = core.channel.text.resolveMarkdownTableMode({
    cfg: cfgForText,
    channel: "feishu",
  });
  let isFirstChunk = true;

  return {
    async deliver(payload: ReplyPayload) {
      runtime.log?.(`feishu deliver called: text=${payload.text?.slice(0, 100)}`);
      const text = payload.text ?? "";
      if (!text.trim()) {
        runtime.log?.(`feishu deliver: empty text, skipping`);
        return;
      }

      const feishuCfg = accountConfig ?? (cfg.channels?.feishu as FeishuConfig | undefined);
      const renderMode = feishuCfg?.renderMode ?? "auto";
      const useCard =
        renderMode === "card" || (renderMode === "auto" && shouldUseCard(text));

      if (useCard) {
        const chunks = core.channel.text.chunkTextWithMode(text, textChunkLimit, chunkMode);
        runtime.log?.(`feishu deliver: sending ${chunks.length} card chunks to ${chatId}`);
        for (const chunk of chunks) {
          await sendMarkdownCardFeishu({
            cfg,
            to: chatId,
            text: chunk,
            replyToMessageId,
            mentions: isFirstChunk ? mentionTargets : undefined,
            accountId,
          });
          isFirstChunk = false;
        }
        return;
      }

      const converted = core.channel.text.convertMarkdownTables(text, tableMode);
      const chunks = core.channel.text.chunkTextWithMode(converted, textChunkLimit, chunkMode);
      runtime.log?.(`feishu deliver: sending ${chunks.length} text chunks to ${chatId}`);
      for (const chunk of chunks) {
        await sendMessageFeishu({
          cfg,
          to: chatId,
          text: chunk,
          replyToMessageId,
          mentions: isFirstChunk ? mentionTargets : undefined,
          accountId,
        });
        isFirstChunk = false;
      }
    },
  };
}

function createAgentCardRenderer(params: CreateFeishuRendererParams): FeishuRenderController {
  const { cfg, runtime, chatId, replyToMessageId, mentionTargets, accountId } = params;
  const tracker = new AgentRunTracker();
  let messageId: string | null = null;
  let assistantBuffer = "";
  let updater: ReturnType<typeof createCardUpdateController> | null = null;

  const assistantBufferState = { text: "" };

  const renderCard = (collapseTimeline: boolean) => {
    const state = tracker.buildRenderState({ collapseTimeline });
    const body = applyMentions(mentionTargets, state.body);
    const card = buildLarkCard({
      ...state,
      body,
    });
    if (!messageId) {
      return card;
    }
    updater?.schedule(card);
    return card;
  };

  return {
    async deliver(payload: ReplyPayload) {
      const messages = extractAgentMessages(payload);
      const events = extractVerboseEvents(payload);
      const payloadText = payload.text ?? "";

      if (events && events.length > 0) {
        for (const evt of events) {
          applyVerboseEvent({ tracker, event: evt, assistantBuffer: assistantBufferState });
        }
        if (assistantBufferState.text) {
          assistantBuffer = assistantBufferState.text;
        }
      }

      if (messages && messages.length > 0) {
        const nextStatus = inferStatusFromMessages(messages);
        if (nextStatus) {
          tracker.setStatus(nextStatus);
        }
        tracker.appendMessages(messages);
      } else if (payloadText.trim()) {
        assistantBuffer = mergeStreamText(assistantBuffer, payloadText);
        tracker.setDraftAnswer(assistantBuffer);
        tracker.setStatus(AgentRunStatus.Thinking);
      } else if (!events || events.length === 0) {
        runtime.log?.(`feishu deliver: empty text, skipping`);
        return;
      }

      if (!messageId) {
        const card = renderCard(false);
        const result = await sendCardFeishu({ cfg, to: chatId, card, replyToMessageId, accountId });
        messageId = result.messageId;
        updater = createCardUpdateController({ cfg, messageId, accountId });
        return;
      }

      renderCard(false);
    },
    finalize: async () => {
      if (!messageId && !assistantBuffer.trim() && tracker.currentStatus === AgentRunStatus.Thinking) {
        return;
      }
      tracker.setStatus(AgentRunStatus.Completed);
      renderCard(true);
      await updater?.flush();
    },
    onError: async () => {
      if (!messageId && !assistantBuffer.trim()) return;
      tracker.setStatus(AgentRunStatus.Error);
      renderCard(true);
      await updater?.flush();
    },
  };
}

export function createFeishuRenderer(params: CreateFeishuRendererParams): FeishuRenderController {
  const feishuCfg = params.accountConfig ?? (params.cfg.channels?.feishu as FeishuConfig | undefined);
  const renderEngine = feishuCfg?.renderEngine ?? "simple";
  if (renderEngine === "agent-card") {
    return createAgentCardRenderer(params);
  }
  return createSimpleRenderer(params);
}
