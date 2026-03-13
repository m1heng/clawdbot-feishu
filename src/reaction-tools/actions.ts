import type * as Lark from "@larksuiteoapi/node-sdk";
import { runFeishuApiCall, type FeishuApiResponse } from "../tools-common/feishu-api.js";
import type { FeishuReactionParams } from "./schemas.js";

interface ReactionCreateResponse extends FeishuApiResponse {
  data?: { reaction_id?: string };
}

interface ReactionListResponse extends FeishuApiResponse {
  data?: {
    items?: Array<{
      reaction_id?: string;
      reaction_type?: { emoji_type?: string };
      operator_type?: string;
      operator_id?: { open_id?: string; user_id?: string; union_id?: string };
    }>;
    has_more?: boolean;
    page_token?: string;
  };
}

export async function runReactionAction(
  client: Lark.Client,
  params: FeishuReactionParams,
): Promise<unknown> {
  switch (params.action) {
    case "add":
      return addReaction(client, params);
    case "remove":
      return removeReaction(client, params);
    case "list":
      return listReactions(client, params);
  }
}

async function addReaction(client: Lark.Client, params: FeishuReactionParams) {
  if (!params.emoji_type) {
    throw new Error("emoji_type is required for action=add");
  }

  const response = await runFeishuApiCall<ReactionCreateResponse>(
    "Feishu add reaction",
    () =>
      client.im.messageReaction.create({
        path: { message_id: params.message_id },
        data: { reaction_type: { emoji_type: params.emoji_type! } },
      }) as Promise<ReactionCreateResponse>,
  );

  return {
    ok: true,
    action: "add",
    message_id: params.message_id,
    emoji_type: params.emoji_type,
    reaction_id: response.data?.reaction_id ?? null,
  };
}

async function removeReaction(client: Lark.Client, params: FeishuReactionParams) {
  if (!params.reaction_id) {
    throw new Error("reaction_id is required for action=remove");
  }

  await runFeishuApiCall<FeishuApiResponse>(
    "Feishu remove reaction",
    () =>
      client.im.messageReaction.delete({
        path: {
          message_id: params.message_id,
          reaction_id: params.reaction_id!,
        },
      }) as Promise<FeishuApiResponse>,
  );

  return {
    ok: true,
    action: "remove",
    message_id: params.message_id,
    reaction_id: params.reaction_id,
  };
}

async function listReactions(client: Lark.Client, params: FeishuReactionParams) {
  const allItems: Array<{
    reaction_id: string;
    emoji_type: string;
    operator_type: string;
    operator_id: string;
  }> = [];

  let pageToken: string | undefined;
  do {
    const response = await runFeishuApiCall<ReactionListResponse>(
      "Feishu list reactions",
      () =>
        client.im.messageReaction.list({
          path: { message_id: params.message_id },
          params: {
            ...(params.emoji_type ? { reaction_type: params.emoji_type } : {}),
            ...(pageToken ? { page_token: pageToken } : {}),
            page_size: 50,
          },
        }) as Promise<ReactionListResponse>,
    );

    for (const item of response.data?.items ?? []) {
      allItems.push({
        reaction_id: item.reaction_id ?? "",
        emoji_type: item.reaction_type?.emoji_type ?? "",
        operator_type: item.operator_type ?? "user",
        operator_id:
          item.operator_id?.open_id ?? item.operator_id?.user_id ?? item.operator_id?.union_id ?? "",
      });
    }

    pageToken = response.data?.has_more ? (response.data.page_token ?? undefined) : undefined;
  } while (pageToken);

  return {
    ok: true,
    action: "list",
    message_id: params.message_id,
    emoji_type_filter: params.emoji_type ?? null,
    total: allItems.length,
    reactions: allItems,
  };
}
