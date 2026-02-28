/**
 * Bot-to-Bot Relay Module
 *
 * Enables bots to trigger each other via @mentions in group chats.
 * When a bot sends a message with @mention tags for other bots,
 * this module creates synthetic events to trigger the mentioned bots.
 *
 * Also provides dynamic teammate discovery for all agents.
 */

import type { ClawdbotConfig, RuntimeEnv, HistoryEntry } from "openclaw/plugin-sdk";
import type { FeishuMessageEvent } from "./bot.js";
import { handleFeishuMessage } from "./bot.js";

// Bot registry: maps bot OpenID to { accountId, name }
interface BotInfo {
  accountId: string;
  openId: string;
  name: string;
  specialty?: string;
}
const botRegistry = new Map<string, BotInfo>();

// Config and runtime references for relay
let relayConfig: ClawdbotConfig | null = null;
let relayRuntime: RuntimeEnv | null = null;
// Shared chat histories reference
let relayChatHistories: Map<string, HistoryEntry[]> | null = null;

// Bot specialty descriptions (can be extended)
const BOT_SPECIALTIES: Record<string, string> = {
  "tech-lead-bot": "技术决策、任务分配、架构讨论",
  "ios-bot": "iOS、Swift、SwiftUI 开发",
  "golang-bot": "Go、后端、API、数据库",
  "default": "通用助手",
};

// Bot display names
const BOT_DISPLAY_NAMES: Record<string, string> = {
  "tech-lead-bot": "Tech Lead",
  "ios-bot": "iOS助手",
  "golang-bot": "Go助手",
  "default": "助手",
};

/**
 * Register a bot for relay (called during monitor startup)
 */
export function registerBotForRelay(params: {
  accountId: string;
  botOpenId: string;
  cfg: ClawdbotConfig;
  runtime?: RuntimeEnv;
  chatHistories: Map<string, HistoryEntry[]>;
}): void {
  const { accountId, botOpenId, cfg, runtime, chatHistories } = params;

  const botInfo: BotInfo = {
    accountId,
    openId: botOpenId,
    name: BOT_DISPLAY_NAMES[accountId] ?? accountId,
    specialty: BOT_SPECIALTIES[accountId],
  };

  botRegistry.set(botOpenId, botInfo);
  relayConfig = cfg;
  relayRuntime = runtime ?? null;
  relayChatHistories = chatHistories;
  runtime?.log?.(`bot-relay: registered ${accountId} (${botOpenId})`);
}

/**
 * Unregister a bot from relay
 */
export function unregisterBotFromRelay(botOpenId: string): void {
  botRegistry.delete(botOpenId);
}

/**
 * Get all registered teammates (excluding the current bot)
 * Returns formatted string for injection into agent context
 */
export function getTeammatesContext(excludeAccountId?: string): string {
  const teammates = Array.from(botRegistry.values())
    .filter(bot => bot.accountId !== excludeAccountId);

  if (teammates.length === 0) {
    return "";
  }

  const lines = [
    "",
    "## 🤝 群内可用的 AI 队友",
    "",
    "你可以 @mention 以下队友来协作：",
    "",
    "| 队友 | 专长 | @mention 格式 |",
    "|------|------|---------------|",
  ];

  for (const bot of teammates) {
    const mentionFormat = `\`<at user_id="${bot.openId}">${bot.name}</at>\``;
    lines.push(`| **${bot.name}** | ${bot.specialty ?? "通用"} | ${mentionFormat} |`);
  }

  lines.push("");
  lines.push("### 如何正确 @mention");
  lines.push("");
  lines.push("在你的回复中直接写入 `<at user_id=\"...\">名字</at>` 格式，例如：");
  lines.push("");

  // Add example for each teammate
  for (const bot of teammates.slice(0, 2)) {
    lines.push("```");
    lines.push(`这个问题需要 ${bot.specialty?.split("、")[0] ?? bot.name} 专家来解答，<at user_id="${bot.openId}">${bot.name}</at> 请帮忙分析。`);
    lines.push("```");
    lines.push("");
  }

  lines.push("⚠️ **重要**：必须使用 `<at user_id=\"...\">` 格式，纯文本 `@名字` 不会触发队友！");
  lines.push("");

  return lines.join("\n");
}

/**
 * Parse @mention tags from bot reply text
 * Format: <at user_id="ou_xxx">Name</at>
 */
export function parseMentionTags(text: string): { openId: string; name: string }[] {
  const regex = /<at\s+user_id="(ou_[a-f0-9]+)"[^>]*>([^<]*)<\/at>/gi;
  const mentions: { openId: string; name: string }[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    mentions.push({ openId: match[1], name: match[2] });
  }
  return mentions;
}

/**
 * Check if an OpenID belongs to a registered bot
 */
export function isBotOpenId(openId: string): boolean {
  return botRegistry.has(openId);
}

/**
 * Get accountId for a bot OpenID
 */
export function getBotAccountId(openId: string): string | undefined {
  return botRegistry.get(openId)?.accountId;
}

/**
 * Get bot info by OpenID
 */
export function getBotInfo(openId: string): BotInfo | undefined {
  return botRegistry.get(openId);
}

/**
 * Trigger relay for mentioned bots
 * Called after a bot sends a reply
 */
export async function triggerBotRelay(params: {
  sourceAccountId: string;
  sourceBotName: string;
  chatId: string;
  messageText: string;
  originalMessageId?: string;
}): Promise<void> {
  if (!relayConfig || !relayChatHistories) {
    return;
  }

  const { sourceAccountId, sourceBotName, chatId, messageText, originalMessageId } = params;
  const mentions = parseMentionTags(messageText);
  
  // Find bots that were mentioned
  const botMentions = mentions.filter(m => isBotOpenId(m.openId));
  
  if (botMentions.length === 0) {
    return;
  }

  relayRuntime?.log?.(`bot-relay: ${sourceAccountId} mentioned ${botMentions.length} bot(s): ${botMentions.map(m => m.name).join(", ")}`);

  // Trigger each mentioned bot with a synthetic event
  for (const mention of botMentions) {
    const targetAccountId = getBotAccountId(mention.openId);
    if (!targetAccountId) continue;

    // Create synthetic event that looks like a user message
    const syntheticEvent: FeishuMessageEvent = {
      message: {
        message_id: `synthetic_${Date.now()}_${targetAccountId}`,
        chat_id: chatId,
        chat_type: "group",
        message_type: "text",
        content: JSON.stringify({ text: messageText }),
        mentions: [{ id: { open_id: mention.openId }, name: mention.name, key: "@_user_1" }],
      },
      sender: {
        sender_id: { open_id: `bot_${sourceAccountId}` },
        sender_type: "bot",
      },
      // Mark as synthetic for potential special handling
      _synthetic: true,
      _sourceBot: sourceAccountId,
      _sourceBotName: sourceBotName,
    } as FeishuMessageEvent & { _synthetic?: boolean; _sourceBot?: string; _sourceBotName?: string };

    try {
      await handleFeishuMessage({
        cfg: relayConfig,
        event: syntheticEvent,
        botOpenId: mention.openId,
        runtime: relayRuntime ?? undefined,
        chatHistories: relayChatHistories,
        accountId: targetAccountId,
      });
      relayRuntime?.log?.(`bot-relay: triggered ${targetAccountId} successfully`);
    } catch (err) {
      relayRuntime?.error?.(`bot-relay: failed to trigger ${targetAccountId}: ${String(err)}`);
    }
  }
}

/**
 * Get all registered bots info
 */
export function getRegisteredBots(): { openId: string; accountId: string }[] {
  return Array.from(botRegistry.entries()).map(([openId, accountId]) => ({ openId, accountId }));
}

