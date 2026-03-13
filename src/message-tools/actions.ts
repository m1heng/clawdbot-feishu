import type * as Lark from "@larksuiteoapi/node-sdk";
import { runFeishuApiCall, type FeishuApiResponse } from "../tools-common/feishu-api.js";
import type { FeishuMessageParams } from "./schemas.js";

interface MessageGetResponse extends FeishuApiResponse {
  data?: {
    items?: Array<{
      message_id?: string;
      root_id?: string;
      parent_id?: string;
      msg_type?: string;
      create_time?: string;
      update_time?: string;
      deleted?: boolean;
      chat_id?: string;
      sender?: { id: string; id_type: string; sender_type: string };
      body?: { content: string };
      mentions?: Array<{ key: string; id: string; id_type: string; name: string }>;
    }>;
  };
}

interface MessageListResponse extends FeishuApiResponse {
  data?: {
    has_more?: boolean;
    page_token?: string;
    items?: Array<{
      message_id?: string;
      root_id?: string;
      parent_id?: string;
      msg_type?: string;
      create_time?: string;
      deleted?: boolean;
      chat_id?: string;
      sender?: { id: string; id_type: string; sender_type: string };
      body?: { content: string };
    }>;
  };
}

export async function runMessageAction(
  client: Lark.Client,
  params: FeishuMessageParams,
): Promise<unknown> {
  switch (params.action) {
    case "get":
      return getMessage(client, params);
    case "list":
      return listMessages(client, params);
  }
}

function parseMessageContent(msgType: string | undefined, rawContent: string | undefined): string {
  if (!rawContent) return "";
  try {
    const parsed = JSON.parse(rawContent);
    if (msgType === "text") return (parsed.text as string) ?? rawContent;
    if (msgType === "post") {
      const title = (parsed.title as string) ?? "";
      const lines: string[] = [];
      for (const paragraph of (parsed.content as Array<Array<{ tag: string; text?: string }>>) ?? []) {
        lines.push(paragraph.map((el) => el.text ?? "").join(""));
      }
      return title ? `${title}\n${lines.join("\n")}` : lines.join("\n");
    }
    if (msgType === "image") return "[image]";
    if (msgType === "file") return `[file: ${(parsed.file_name as string) ?? ""}]`;
    if (msgType === "audio") return "[audio]";
    if (msgType === "sticker") return "[sticker]";
    if (msgType === "share_chat") return "[share_chat]";
    if (msgType === "share_user") return "[share_user]";
    return `[${msgType ?? "unknown"}]`;
  } catch {
    return rawContent;
  }
}

async function getMessage(client: Lark.Client, params: FeishuMessageParams) {
  if (!params.message_id) {
    throw new Error("message_id is required for action=get");
  }

  const response = await runFeishuApiCall<MessageGetResponse>(
    "Feishu get message",
    () =>
      client.im.message.get({
        path: { message_id: params.message_id! },
      }) as Promise<MessageGetResponse>,
  );

  const item = response.data?.items?.[0];
  if (!item) {
    return { ok: true, action: "get", message_id: params.message_id, found: false };
  }

  return {
    ok: true,
    action: "get",
    found: true,
    message_id: item.message_id ?? params.message_id,
    msg_type: item.msg_type ?? "",
    content: parseMessageContent(item.msg_type, item.body?.content),
    sender_id: item.sender?.id ?? "",
    sender_type: item.sender?.sender_type ?? "",
    chat_id: item.chat_id ?? "",
    create_time: item.create_time ?? "",
    update_time: item.update_time ?? "",
    mentions: item.mentions?.map((m) => ({ id: m.id, name: m.name })) ?? [],
  };
}

async function listMessages(client: Lark.Client, params: FeishuMessageParams) {
  if (!params.chat_id) {
    throw new Error("chat_id is required for action=list");
  }

  const pageSize = Math.min(Math.max(params.page_size ?? 10, 1), 50);
  const sortType = params.sort_type ?? "ByCreateTimeDesc";

  const response = await runFeishuApiCall<MessageListResponse>(
    "Feishu list messages",
    () =>
      client.im.message.list({
        params: {
          container_id_type: "chat",
          container_id: params.chat_id!,
          sort_type: sortType,
          page_size: pageSize,
          ...(params.start_time ? { start_time: params.start_time } : {}),
          ...(params.end_time ? { end_time: params.end_time } : {}),
        },
      }) as Promise<MessageListResponse>,
  );

  const messages = (response.data?.items ?? [])
    .filter((item) => !item.deleted)
    .map((item) => ({
      message_id: item.message_id ?? "",
      msg_type: item.msg_type ?? "",
      content_preview: parseMessageContent(item.msg_type, item.body?.content),
      sender_id: item.sender?.id ?? "",
      sender_type: item.sender?.sender_type ?? "",
      create_time: item.create_time ?? "",
      chat_id: item.chat_id ?? "",
    }));

  return {
    ok: true,
    action: "list",
    chat_id: params.chat_id,
    total: messages.length,
    messages,
  };
}
