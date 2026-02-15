import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk";
import { getFeishuRuntime } from "./runtime.js";
import { sendMessageFeishu } from "./send.js";
import { sendMediaFeishu } from "./media.js";
import type { MentionTarget } from "./mention.js";

// 解析@语法的辅助函数
function parseMentionsFromText(text: string): { mentions: MentionTarget[]; cleanText: string } {
  const mentions: MentionTarget[] = [];
  let cleanText = text;
  
  // 匹配 @user_id:name 或 @app_id:name 格式
  const mentionRegex = /@((?:ou_|cli_)[a-zA-Z0-9_-]+)(?::([^@\s]+))?/g;
  let match;
  
  while ((match = mentionRegex.exec(text)) !== null) {
    const [fullMatch, id, name] = match;
    mentions.push({
      openId: id,
      name: name || id, // 如果没有提供名字，使用ID
      key: fullMatch, // 原始匹配的文本作为key
    });
    // 从文本中移除@语法，替换为普通文本
    cleanText = cleanText.replace(fullMatch, name || id);
  }
  
  return { mentions, cleanText };
}

export const feishuOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: (text, limit) => getFeishuRuntime().channel.text.chunkMarkdownText(text, limit),
  chunkerMode: "markdown",
  textChunkLimit: 4000,
  sendText: async ({ cfg, to, text, accountId }) => {
    // 解析@语法
    const { mentions, cleanText } = parseMentionsFromText(text);
    
    // 发送消息，包含@功能
    const result = await sendMessageFeishu({ 
      cfg, 
      to, 
      text: cleanText,
      mentions: mentions.length > 0 ? mentions : undefined,
      accountId 
    });
    return { channel: "feishu", ...result };
  },
  sendMedia: async ({ cfg, to, text, mediaUrl, accountId }) => {
    // Send text first if provided
    if (text?.trim()) {
      // 解析@语法
      const { mentions, cleanText } = parseMentionsFromText(text);
      await sendMessageFeishu({ 
        cfg, 
        to, 
        text: cleanText,
        mentions: mentions.length > 0 ? mentions : undefined,
        accountId
      });
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
    const { mentions, cleanText } = parseMentionsFromText(text ?? "");
    const result = await sendMessageFeishu({ 
      cfg, 
      to, 
      text: cleanText,
      mentions: mentions.length > 0 ? mentions : undefined,
      accountId
    });
    return { channel: "feishu", ...result };
  },
};