/**
 * Feishu Draft Stream - Real-time message updates via card patching.
 * Similar to Telegram's draft stream implementation.
 *
 * Feishu supports updating interactive cards via PATCH /im/v1/messages/:message_id.
 * We use this to implement streaming responses:
 * 1. Send an initial card with placeholder text
 * 2. Patch the card as new content arrives
 * 3. Optionally convert to final text message when complete
 *
 * Constraints:
 * - Only cards with config.update_multi=true can be updated
 * - Rate limit: 5 QPS per message
 * - Max 14 days after send
 * - Card content max 30KB
 */

import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import { sendCardFeishu, updateCardFeishu, buildMarkdownCard } from "./send.js";
import type { FeishuConfig } from "./types.js";

const FEISHU_CARD_MAX_CHARS = 25000; // Leave margin for JSON overhead
const DEFAULT_THROTTLE_MS = 250; // Feishu allows 5 QPS, ~200ms minimum between updates

export type FeishuDraftStreamParams = {
  cfg: ClawdbotConfig;
  chatId: string;
  replyToMessageId?: string;
  maxChars?: number;
  throttleMs?: number;
  log?: (message: string) => void;
  warn?: (message: string) => void;
};

export type FeishuDraftStream = {
  /** Update the draft content. Throttled automatically. */
  update: (text: string) => void;
  /** Force flush any pending content. */
  flush: () => Promise<void>;
  /** Stop the stream and cleanup. Returns the final message ID if sent. */
  stop: () => void;
  /** Get the current message ID (undefined until first send). */
  getMessageId: () => string | undefined;
};

/**
 * Build a streamable markdown card.
 * Must include config.update_multi=true to allow updates.
 */
function buildStreamableCard(text: string): Record<string, unknown> {
  return {
    config: {
      wide_screen_mode: true,
      update_multi: true, // Required for patching
    },
    elements: [
      {
        tag: "markdown",
        content: text || "...",
      },
    ],
  };
}

export function createFeishuDraftStream(params: FeishuDraftStreamParams): FeishuDraftStream {
  const maxChars = Math.min(
    params.maxChars ?? FEISHU_CARD_MAX_CHARS,
    FEISHU_CARD_MAX_CHARS,
  );
  const throttleMs = Math.max(50, params.throttleMs ?? DEFAULT_THROTTLE_MS);

  let lastSentText = "";
  let lastSentAt = 0;
  let pendingText = "";
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let messageId: string | undefined;
  let sendPromise: Promise<void> | undefined;

  const sendOrUpdateCard = async (text: string): Promise<void> => {
    if (stopped) return;

    const trimmed = text.trimEnd();
    if (!trimmed) return;

    if (trimmed.length > maxChars) {
      // Card content too large. Stop streaming to avoid failures.
      stopped = true;
      params.warn?.(
        `feishu draft stream stopped (content length ${trimmed.length} > ${maxChars})`,
      );
      return;
    }

    if (trimmed === lastSentText) return;

    lastSentText = trimmed;
    lastSentAt = Date.now();

    try {
      if (!messageId) {
        // First send - create the card
        const card = buildStreamableCard(trimmed);
        const result = await sendCardFeishu({
          cfg: params.cfg,
          to: params.chatId,
          card,
          replyToMessageId: params.replyToMessageId,
        });
        messageId = result.messageId;
        params.log?.(`feishu draft stream: initial card sent (messageId=${messageId})`);
      } else {
        // Subsequent updates - patch the existing card
        const card = buildStreamableCard(trimmed);
        await updateCardFeishu({
          cfg: params.cfg,
          messageId,
          card,
        });
        params.log?.(`feishu draft stream: card updated (${trimmed.length} chars)`);
      }
    } catch (err) {
      stopped = true;
      const errMsg = err instanceof Error ? err.message : String(err);
      params.warn?.(`feishu draft stream failed: ${errMsg}`);
    }
  };

  const flush = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }

    if (inFlight) {
      // Schedule retry after current operation
      schedule();
      return;
    }

    const text = pendingText;
    pendingText = "";

    if (!text.trim()) {
      if (pendingText) schedule();
      return;
    }

    inFlight = true;
    try {
      await sendOrUpdateCard(text);
    } finally {
      inFlight = false;
    }

    if (pendingText) schedule();
  };

  const schedule = (): void => {
    if (timer) return;
    const delay = Math.max(0, throttleMs - (Date.now() - lastSentAt));
    timer = setTimeout(() => {
      timer = undefined;
      void flush();
    }, delay);
  };

  const update = (text: string): void => {
    if (stopped) return;

    pendingText = text;

    if (inFlight) {
      schedule();
      return;
    }

    if (!timer && Date.now() - lastSentAt >= throttleMs) {
      void flush();
      return;
    }

    schedule();
  };

  const stop = (): void => {
    stopped = true;
    pendingText = "";
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const getMessageId = (): string | undefined => messageId;

  params.log?.(
    `feishu draft stream ready (maxChars=${maxChars}, throttleMs=${throttleMs})`,
  );

  return { update, flush, stop, getMessageId };
}
