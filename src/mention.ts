import type { FeishuMessageEvent } from "./bot.js";

/**
 * @ 目标用户信息
 */
export type MentionTarget = {
  openId: string;
  name: string;
  key: string; // 原消息中的占位符，如 @_user_1
};

/**
 * 从消息事件中提取 @ 目标（排除机器人自己）
 */
export function extractMentionTargets(
  event: FeishuMessageEvent,
  botOpenId?: string,
): MentionTarget[] {
  const mentions = event.message.mentions ?? [];

  return mentions
    .filter((m) => {
      // 排除机器人自己
      if (botOpenId && m.id.open_id === botOpenId) return false;
      // 必须有 open_id
      return !!m.id.open_id;
    })
    .map((m) => ({
      openId: m.id.open_id!,
      name: m.name,
      key: m.key,
    }));
}

/**
 * 判断消息是否是 @ 转发请求
 * 规则：
 * - 群聊：消息中 @ 了机器人 + 至少还 @ 了其他人
 * - 私聊：消息中 @ 了任何人（不需要 @ 机器人）
 */
export function isMentionForwardRequest(
  event: FeishuMessageEvent,
  botOpenId?: string,
): boolean {
  const mentions = event.message.mentions ?? [];
  if (mentions.length === 0) return false;

  const isDirectMessage = event.message.chat_type === "p2p";
  const hasOtherMention = mentions.some((m) => m.id.open_id !== botOpenId);

  if (isDirectMessage) {
    // 私聊：只要 @ 了任何人（非机器人）就触发
    return hasOtherMention;
  } else {
    // 群聊：需要同时 @ 机器人和其他人
    const hasBotMention = mentions.some((m) => m.id.open_id === botOpenId);
    return hasBotMention && hasOtherMention;
  }
}

/**
 * 从消息文本中提取正文（移除 @ 占位符）
 */
export function extractMessageBody(text: string, allMentionKeys: string[]): string {
  let result = text;

  // 移除所有 @ 占位符
  for (const key of allMentionKeys) {
    result = result.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "");
  }

  return result.replace(/\s+/g, " ").trim();
}

/**
 * 格式化 @ 文本消息
 */
export function formatMentionForText(target: MentionTarget): string {
  return `<at user_id="${target.openId}">${target.name}</at>`;
}

/**
 * 格式化 @ 所有人（文本消息）
 */
export function formatMentionAllForText(): string {
  return `<at user_id="all">所有人</at>`;
}

/**
 * 格式化 @ 卡片消息 (lark_md)
 */
export function formatMentionForCard(target: MentionTarget): string {
  return `<at id=${target.openId}></at>`;
}

/**
 * 格式化 @ 所有人（卡片消息）
 */
export function formatMentionAllForCard(): string {
  return `<at id=all></at>`;
}

/**
 * 构建带 @ 的完整消息（文本格式）
 */
export function buildMentionedMessage(targets: MentionTarget[], message: string): string {
  if (targets.length === 0) return message;

  const mentionParts = targets.map((t) => formatMentionForText(t));
  return `${mentionParts.join(" ")} ${message}`;
}

/**
 * 构建带 @ 的卡片内容（Markdown 格式）
 */
export function buildMentionedCardContent(targets: MentionTarget[], message: string): string {
  if (targets.length === 0) return message;

  const mentionParts = targets.map((t) => formatMentionForCard(t));
  return `${mentionParts.join(" ")} ${message}`;
}
