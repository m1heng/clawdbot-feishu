import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk";
import { getFeishuRuntime } from "./runtime.js";
import { sendMessageFeishu } from "./send.js";
import { sendMediaFeishu } from "./media.js";

/**
 * Resolve Feishu reply-to message ID from outbound context.
 *
 * In Feishu topic groups, replying to a message in a topic keeps the reply
 * within that topic. Without a reply target, im.message.create() creates
 * a new topic in the group — which is not desired for sub-agent results.
 *
 * Priority: explicit replyToId > threadId (stored as root_id from inbound).
 */
function resolveFeishuReplyToMessageId(
  replyToId?: string | null,
  threadId?: string | number | null,
): string | undefined {
  if (typeof replyToId === "string" && replyToId) return replyToId;
  if (typeof threadId === "string" && threadId) return threadId;
  return undefined;
}

export const feishuOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: (text, limit) => getFeishuRuntime().channel.text.chunkMarkdownText(text, limit),
  chunkerMode: "markdown",
  textChunkLimit: 4000,
  sendText: async ({ cfg, to, text, accountId, replyToId, threadId }) => {
    const replyToMessageId = resolveFeishuReplyToMessageId(replyToId, threadId);
    const result = await sendMessageFeishu({ cfg, to, text, accountId, replyToMessageId });
    return { channel: "feishu", ...result };
  },
  sendMedia: async ({ cfg, to, text, mediaUrl, accountId, replyToId, threadId }) => {
    const replyToMessageId = resolveFeishuReplyToMessageId(replyToId, threadId);

    // Send text first if provided
    if (text?.trim()) {
      await sendMessageFeishu({ cfg, to, text, accountId, replyToMessageId });
    }

    // Upload and send media if URL provided
    if (mediaUrl) {
      try {
        const result = await sendMediaFeishu({ cfg, to, mediaUrl, accountId });
        return { channel: "feishu", ...result };
      } catch (err) {
        // Log the error for debugging
        console.error(`[feishu] sendMediaFeishu failed:`, err);
        // Fallback to URL link if upload fails
        const fallbackText = `📎 ${mediaUrl}`;
        const result = await sendMessageFeishu({ cfg, to, text: fallbackText, accountId, replyToMessageId });
        return { channel: "feishu", ...result };
      }
    }

    // No media URL, just return text result
    const result = await sendMessageFeishu({ cfg, to, text: text ?? "", accountId, replyToMessageId });
    return { channel: "feishu", ...result };
  },
};
