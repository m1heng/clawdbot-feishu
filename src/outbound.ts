import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk";
import { getFeishuRuntime } from "./runtime.js";
import { sendMessageFeishu, sendMarkdownCardFeishu } from "./send.js";
import { sendMediaFeishu } from "./media.js";
import type { FeishuConfig } from "./types.js";
import { resolveFeishuAccount } from "./accounts.js";

function shouldUseCard(text: string): boolean {
  if (/```[\s\S]*?```/.test(text)) return true;
  if (/\|.+\|[\r\n]+\|[-:| ]+\|/.test(text)) return true;
  return false;
}

export const feishuOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: (text, limit) => getFeishuRuntime().channel.text.chunkMarkdownText(text, limit),
  chunkerMode: "markdown",
  textChunkLimit: 4000,
  sendText: async ({ cfg, to, text, accountId }) => {
    const account = resolveFeishuAccount({ cfg, accountId });
    const feishuCfg = account.config as FeishuConfig | undefined;
    const renderMode = feishuCfg?.renderMode ?? "auto";
    const useCard =
      renderMode === "card" || (renderMode === "auto" && shouldUseCard(text ?? ""));

    if (useCard) {
      const result = await sendMarkdownCardFeishu({ cfg, to, text: text ?? "", accountId });
      return { channel: "feishu", ...result };
    }

    const result = await sendMessageFeishu({ cfg, to, text: text ?? "", accountId });
    return { channel: "feishu", ...result };
  },
  sendMedia: async ({ cfg, to, text, mediaUrl, accountId }) => {
    // Send text first if provided
    if (text?.trim()) {
      const account = resolveFeishuAccount({ cfg, accountId });
      const feishuCfg = account.config as FeishuConfig | undefined;
      const renderMode = feishuCfg?.renderMode ?? "auto";
      const useCard =
        renderMode === "card" || (renderMode === "auto" && shouldUseCard(text ?? ""));

      if (useCard) {
        await sendMarkdownCardFeishu({ cfg, to, text, accountId });
      } else {
        await sendMessageFeishu({ cfg, to, text, accountId });
      }
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
        const result = await sendMessageFeishu({ cfg, to, text: fallbackText, accountId });
        return { channel: "feishu", ...result };
      }
    }

    // No media URL, just return text result
    const result = await sendMessageFeishu({ cfg, to, text: text ?? "", accountId });
    return { channel: "feishu", ...result };
  },
};
