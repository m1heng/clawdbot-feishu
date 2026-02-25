import { runWikiApiCall, type WikiClient } from "./common.js";
import type { FeishuWikiParams } from "./schemas.js";

type ObjType = "doc" | "sheet" | "mindnote" | "bitable" | "file" | "docx" | "slides";

const WIKI_ACCESS_HINT =
  "To grant wiki access: Open wiki space -> Settings -> Members -> Add the bot. " +
  "See: https://open.feishu.cn/document/server-docs/docs/wiki-v2/wiki-qa#a40ad4ca";

async function listSpaces(client: WikiClient) {
  const res = await runWikiApiCall("wiki.space.list", () => client.wiki.space.list({}));
  const spaces =
    res.data?.items?.map((s) => ({
      space_id: s.space_id,
      name: s.name,
      description: s.description,
      visibility: s.visibility,
    })) ?? [];

  return {
    spaces,
    ...(spaces.length === 0 && { hint: WIKI_ACCESS_HINT }),
  };
}

async function listNodes(client: WikiClient, spaceId: string, parentNodeToken?: string) {
  const res = await runWikiApiCall("wiki.spaceNode.list", () =>
    client.wiki.spaceNode.list({
      path: { space_id: spaceId },
      params: { parent_node_token: parentNodeToken },
    }),
  );

  return {
    nodes:
      res.data?.items?.map((n) => ({
        node_token: n.node_token,
        obj_token: n.obj_token,
        obj_type: n.obj_type,
        title: n.title,
        has_child: n.has_child,
      })) ?? [],
  };
}

async function getNode(client: WikiClient, token: string) {
  const res = await runWikiApiCall("wiki.space.getNode", () =>
    client.wiki.space.getNode({
      params: { token },
    }),
  );

  const node = res.data?.node;
  return {
    node_token: node?.node_token,
    space_id: node?.space_id,
    obj_token: node?.obj_token,
    obj_type: node?.obj_type,
    title: node?.title,
    parent_node_token: node?.parent_node_token,
    has_child: node?.has_child,
    creator: node?.creator,
    create_time: node?.node_create_time,
  };
}

async function createNode(
  client: WikiClient,
  spaceId: string,
  title: string,
  objType?: string,
  parentNodeToken?: string,
) {
  const res = await runWikiApiCall("wiki.spaceNode.create", () =>
    client.wiki.spaceNode.create({
      path: { space_id: spaceId },
      data: {
        obj_type: (objType as ObjType) || "docx",
        node_type: "origin" as const,
        title,
        parent_node_token: parentNodeToken,
      },
    }),
  );

  const node = res.data?.node;
  return {
    node_token: node?.node_token,
    obj_token: node?.obj_token,
    obj_type: node?.obj_type,
    title: node?.title,
  };
}

async function moveNode(
  client: WikiClient,
  spaceId: string,
  nodeToken: string,
  targetSpaceId?: string,
  targetParentToken?: string,
) {
  const res = await runWikiApiCall("wiki.spaceNode.move", () =>
    client.wiki.spaceNode.move({
      path: { space_id: spaceId, node_token: nodeToken },
      data: {
        target_space_id: targetSpaceId || spaceId,
        target_parent_token: targetParentToken,
      },
    }),
  );

  return {
    success: true,
    node_token: res.data?.node?.node_token,
  };
}

async function renameNode(
  client: WikiClient,
  spaceId: string,
  nodeToken: string,
  title: string,
) {
  await runWikiApiCall("wiki.spaceNode.updateTitle", () =>
    client.wiki.spaceNode.updateTitle({
      path: { space_id: spaceId, node_token: nodeToken },
      data: { title },
    }),
  );

  return {
    success: true,
    node_token: nodeToken,
    title,
  };
}

export async function runWikiAction(client: WikiClient, params: FeishuWikiParams) {
  switch (params.action) {
    case "spaces":
      return listSpaces(client);
    case "nodes":
      return listNodes(client, params.space_id, params.parent_node_token);
    case "get":
      return getNode(client, params.token);
    case "search":
      return {
        error:
          "Search is not available. Use feishu_wiki with action: 'nodes' to browse or action: 'get' to lookup by token.",
      };
    case "create":
      return createNode(client, params.space_id, params.title, params.obj_type, params.parent_node_token);
    case "move":
      return moveNode(
        client,
        params.space_id,
        params.node_token,
        params.target_space_id,
        params.target_parent_token,
      );
    case "rename":
      return renameNode(client, params.space_id, params.node_token, params.title);
    default:
      return { error: `Unknown action: ${(params as any).action}` };
  }
}
