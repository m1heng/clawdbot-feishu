import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk";
import { getFeishuRuntime } from "./runtime.js";
import { sendMessageFeishu } from "./send.js";
import { sendMediaFeishu } from "./media.js";

export const feishuOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: (text, limit) => getFeishuRuntime().channel.text.chunkMarkdownText(text, limit),
  chunkerMode: "markdown",
  textChunkLimit: 4000,
  sendText: async ({ cfg, to, text, accountId, threadId }) => {
    // When threadId is provided (e.g., from message tool auto-threading or
    // sub-agent announces routed back to a topic thread), use it as
    // replyToMessageId so the message is placed inside the existing Feishu
    // topic instead of creating a new one.
    const replyToMessageId = threadId ? String(threadId) : undefined;
    const result = await sendMessageFeishu({ cfg, to, text, accountId, replyToMessageId });
    return { channel: "feishu", ...result };
  },
  sendMedia: async ({ cfg, to, text, mediaUrl, accountId, threadId }) => {
    const replyToMessageId = threadId ? String(threadId) : undefined;

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
