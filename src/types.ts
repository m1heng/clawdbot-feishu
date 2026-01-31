import type { FeishuConfigSchema, FeishuGroupSchema, z } from "./config-schema.js";
import type { MentionTarget } from "./mention.js";

export type FeishuConfig = z.infer<typeof FeishuConfigSchema>;
export type FeishuGroupConfig = z.infer<typeof FeishuGroupSchema>;

export type FeishuDomain = "feishu" | "lark";
export type FeishuConnectionMode = "websocket" | "webhook";

export type ResolvedFeishuAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  appId?: string;
  domain: FeishuDomain;
};

export type FeishuIdType = "open_id" | "user_id" | "union_id" | "chat_id";

export type FeishuMessageContext = {
  chatId: string;
  messageId: string;
  senderId: string;
  senderOpenId: string;
  senderName?: string;
  chatType: "p2p" | "group";
  mentionedBot: boolean;
  rootId?: string;
  parentId?: string;
  content: string;
  contentType: string;
  /** @ 转发目标用户列表（不含机器人自己） */
  mentionTargets?: MentionTarget[];
  /** 提取的消息正文（移除 @ 占位符后） */
  mentionMessageBody?: string;
};

export type FeishuSendResult = {
  messageId: string;
  chatId: string;
};

export type FeishuProbeResult = {
  ok: boolean;
  error?: string;
  appId?: string;
  botName?: string;
  botOpenId?: string;
};

export type FeishuMediaInfo = {
  path: string;
  contentType?: string;
  placeholder: string;
};
