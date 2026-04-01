import { appendDoc, createAndWriteDoc, createDoc, writeDoc } from "../doc-write-service.js";
import { detectDocFormat, runDocApiCall, type DocClient } from "./common.js";
import type { FeishuDocParams } from "./schemas.js";

/**
 * Feishu component_type_id for the Mermaid diagram add-on block.
 * This is a stable constant used by the Feishu editor (block_type 40).
 * Verified by reading existing Mermaid blocks via list_blocks.
 */
const MERMAID_COMPONENT_TYPE_ID = "blk_631fefbbae02400430b8f9f4";

const BLOCK_TYPE_NAMES: Record<number, string> = {
  1: "Page",
  2: "Text",
  3: "Heading1",
  4: "Heading2",
  5: "Heading3",
  12: "Bullet",
  13: "Ordered",
  14: "Code",
  15: "Quote",
  17: "Todo",
  18: "Bitable",
  21: "Diagram",
  22: "Divider",
  23: "File",
  27: "Image",
  30: "Sheet",
  31: "Table",
  32: "TableCell",
};

const STRUCTURED_BLOCK_TYPES = new Set([14, 18, 21, 23, 27, 30, 31, 32]);

function buildCommentContent(content: string) {
  return {
    elements: [
      {
        text_run: { text: content },
        type: "text_run" as const,
      },
    ],
  };
}

function normalizePageSize(pageSize?: number) {
  if (pageSize === undefined) return 50;
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error("page_size must be a positive integer");
  }
  return pageSize;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
  return value;
}

function omitUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as T;
}

async function readLegacyDoc(client: DocClient, docToken: string) {
  const domain = (client as any).domain ?? "https://open.feishu.cn";
  const token = await client.tokenManager.getTenantAccessToken();
  const response = await runDocApiCall("doc.v2.rawContent", () =>
    client.httpInstance.get<{ code?: number; msg?: string; data?: { content?: string } }>(
      `${domain}/open-apis/doc/v2/${docToken}/raw_content`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    ),
  );

  return {
    content: response.data?.content,
    format: "doc" as const,
    hint: "Legacy document format. Only plain text content available. Title not included in this API response.",
  };
}

async function readDoc(client: DocClient, docToken: string) {
  const format = detectDocFormat(docToken);

  if (format === "doc") {
    return readLegacyDoc(client, docToken);
  }

  const [contentRes, infoRes, blocksRes] = await Promise.all([
    runDocApiCall("docx.document.rawContent", () =>
      client.docx.document.rawContent({ path: { document_id: docToken } }),
    ),
    runDocApiCall("docx.document.get", () =>
      client.docx.document.get({ path: { document_id: docToken } }),
    ),
    runDocApiCall("docx.documentBlock.list", () =>
      client.docx.documentBlock.list({ path: { document_id: docToken } }),
    ),
  ]);

  const blocks = blocksRes.data?.items ?? [];
  const blockCounts: Record<string, number> = {};
  const structuredTypes: string[] = [];

  for (const b of blocks) {
    const type = b.block_type ?? 0;
    const name = BLOCK_TYPE_NAMES[type] || `type_${type}`;
    blockCounts[name] = (blockCounts[name] || 0) + 1;

    if (STRUCTURED_BLOCK_TYPES.has(type) && !structuredTypes.includes(name)) {
      structuredTypes.push(name);
    }
  }

  let hint: string | undefined;
  if (structuredTypes.length > 0) {
    hint = `This document contains ${structuredTypes.join(", ")} which are NOT included in the plain text above. Use feishu_doc with action: "list_blocks" to get full content.`;
  }

  return {
    title: infoRes.data?.document?.title,
    content: contentRes.data?.content,
    revision_id: infoRes.data?.document?.revision_id,
    block_count: blocks.length,
    block_types: blockCounts,
    ...(hint && { hint }),
  };
}

async function updateBlock(client: DocClient, docToken: string, blockId: string, content: string) {
  await runDocApiCall("docx.documentBlock.get", () =>
    client.docx.documentBlock.get({
      path: { document_id: docToken, block_id: blockId },
    }),
  );

  await runDocApiCall("docx.documentBlock.patch", () =>
    client.docx.documentBlock.patch({
      path: { document_id: docToken, block_id: blockId },
      data: {
        update_text_elements: {
          elements: [{ text_run: { content } }],
        },
      },
    }),
  );

  return { success: true, block_id: blockId };
}

async function deleteBlock(client: DocClient, docToken: string, blockId: string) {
  const blockInfo = await runDocApiCall("docx.documentBlock.get", () =>
    client.docx.documentBlock.get({
      path: { document_id: docToken, block_id: blockId },
    }),
  );
  const parentId = blockInfo.data?.block?.parent_id ?? docToken;

  const children = await runDocApiCall("docx.documentBlockChildren.get", () =>
    client.docx.documentBlockChildren.get({
      path: { document_id: docToken, block_id: parentId },
    }),
  );

  const items = children.data?.items ?? [];
  const index = items.findIndex((item: any) => item.block_id === blockId);
  if (index === -1) {
    throw new Error("Block not found");
  }

  await runDocApiCall("docx.documentBlockChildren.batchDelete", () =>
    client.docx.documentBlockChildren.batchDelete({
      path: { document_id: docToken, block_id: parentId },
      data: { start_index: index, end_index: index + 1 },
    }),
  );

  return { success: true, deleted_block_id: blockId };
}

async function listBlocks(client: DocClient, docToken: string) {
  const res = await runDocApiCall("docx.documentBlock.list", () =>
    client.docx.documentBlock.list({
      path: { document_id: docToken },
    }),
  );

  return {
    blocks: res.data?.items ?? [],
  };
}

async function getBlock(client: DocClient, docToken: string, blockId: string) {
  const res = await runDocApiCall("docx.documentBlock.get", () =>
    client.docx.documentBlock.get({
      path: { document_id: docToken, block_id: blockId },
    }),
  );

  return {
    block: res.data?.block,
  };
}

async function listComments(client: DocClient, docToken: string, pageToken?: string, pageSize?: number) {
  const res = await runDocApiCall("drive.fileComment.list", () =>
    client.drive.fileComment.list({
      path: { file_token: docToken },
      params: omitUndefined({
        file_type: "docx" as const,
        page_token: pageToken,
        page_size: normalizePageSize(pageSize),
      }),
    }),
  );

  return {
    comments: Array.isArray(res.data?.items) ? res.data.items : [],
    page_token: res.data?.page_token,
    has_more: Boolean(res.data?.has_more),
  };
}

async function createComment(client: DocClient, docToken: string, content: string) {
  const res = await runDocApiCall("drive.fileComment.create", () =>
    client.drive.fileComment.create({
      path: { file_token: docToken },
      params: {
        file_type: "docx",
      },
      data: {
        reply_list: {
          replies: [
            {
              content: buildCommentContent(content),
            },
          ],
        },
      },
    }),
  );

  if (!res.data?.comment_id) {
    throw new Error("Comment creation failed: No comment ID returned");
  }

  return {
    comment_id: res.data.comment_id,
    comment: res.data,
  };
}

async function getComment(client: DocClient, docToken: string, commentId: string) {
  const res = await runDocApiCall("drive.fileComment.get", () =>
    client.drive.fileComment.get({
      path: { file_token: docToken, comment_id: commentId },
      params: {
        file_type: "docx",
      },
    }),
  );

  if (!res.data) {
    throw new Error(`Comment not found: ${commentId}`);
  }

  return {
    comment: res.data,
  };
}

async function listCommentReplies(
  client: DocClient,
  docToken: string,
  commentId: string,
  pageToken?: string,
  pageSize?: number,
) {
  const res = await runDocApiCall("drive.fileCommentReply.list", () =>
    client.drive.fileCommentReply.list({
      path: { file_token: docToken, comment_id: commentId },
      params: omitUndefined({
        file_type: "docx" as const,
        page_token: pageToken,
        page_size: normalizePageSize(pageSize),
      }),
    }),
  );

  return {
    replies: Array.isArray(res.data?.items) ? res.data.items : [],
    page_token: res.data?.page_token,
    has_more: Boolean(res.data?.has_more),
  };
}

export async function listAppScopes(client: DocClient) {
  const res = await runDocApiCall("application.scope.list", () => client.application.scope.list({}));
  const scopes = res.data?.scopes ?? [];
  const granted = scopes.filter((s) => s.grant_status === 1);
  const pending = scopes.filter((s) => s.grant_status !== 1);

  return {
    granted: granted.map((s) => ({ name: s.scope_name, type: s.scope_type })),
    pending: pending.map((s) => ({ name: s.scope_name, type: s.scope_type })),
    summary: `${granted.length} granted, ${pending.length} pending`,
  };
}

/**
 * Create a Mermaid diagram block in a Feishu document.
 *
 * Feishu renders diagrams as add-on component blocks (block_type 40).
 * The Lark SDK's `documentBlockChildren.create` performs client-side
 * validation that rejects block_type 40, so we use the raw HTTP API
 * endpoint directly to bypass this limitation.
 */
async function createDiagram(
  client: DocClient,
  docToken: string,
  content: string,
) {
  const record = JSON.stringify({
    data: content,
    theme: "default",
    view: "chart",
  });

  // Use client.httpInstance (axios) instead of bare fetch to respect
  // proxy settings configured via https_proxy / HTTP_PROXY env vars.
  // This matches the pattern used by readLegacyDoc.
  const domain = (client as any).domain ?? "https://open.feishu.cn";
  const token = await client.tokenManager.getTenantAccessToken();
  const url = `${domain}/open-apis/docx/v1/documents/${docToken}/blocks/${docToken}/children`;

  const response = await runDocApiCall("docx.createDiagram", async () => {
    const resp = await client.httpInstance.post<{
      code?: number;
      msg?: string;
      log_id?: string;
      data?: { children?: unknown[] };
    }>(url, {
      children: [
        {
          block_type: 40,
          add_ons: {
            component_type_id: MERMAID_COMPONENT_TYPE_ID,
            record,
          },
        },
      ],
    }, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
    });

    // axios wraps the body in resp.data
    const body = (resp as any).data ?? resp;
    return body as { code?: number; msg?: string; log_id?: string; data?: { children?: unknown[] } };
  });

  const children = (response as any).data?.children ?? [];
  const diagramBlock = children.find((b: any) => b.block_type === 40);

  return {
    success: true,
    block_id: diagramBlock?.block_id,
    children_count: children.length,
  };
}

export async function runDocAction(
  client: DocClient,
  params: FeishuDocParams,
  mediaMaxBytes: number,
) {
  switch (params.action) {
    case "read":
      return readDoc(client, requireString(params.doc_token, "doc_token"));
    case "write":
      return writeDoc(
        client,
        requireString(params.doc_token, "doc_token"),
        requireString(params.content, "content"),
        mediaMaxBytes,
      );
    case "append":
      return appendDoc(
        client,
        requireString(params.doc_token, "doc_token"),
        requireString(params.content, "content"),
        mediaMaxBytes,
      );
    case "create":
      return createDoc(client, requireString(params.title, "title"), params.folder_token);
    case "create_and_write":
      return createAndWriteDoc(
        client,
        requireString(params.title, "title"),
        requireString(params.content, "content"),
        mediaMaxBytes,
        params.folder_token,
      );
    case "list_blocks":
      return listBlocks(client, requireString(params.doc_token, "doc_token"));
    case "get_block":
      return getBlock(
        client,
        requireString(params.doc_token, "doc_token"),
        requireString(params.block_id, "block_id"),
      );
    case "update_block":
      return updateBlock(
        client,
        requireString(params.doc_token, "doc_token"),
        requireString(params.block_id, "block_id"),
        requireString(params.content, "content"),
      );
    case "delete_block":
      return deleteBlock(
        client,
        requireString(params.doc_token, "doc_token"),
        requireString(params.block_id, "block_id"),
      );
    case "list_comments":
      return listComments(
        client,
        requireString(params.doc_token, "doc_token"),
        params.page_token,
        params.page_size,
      );
    case "create_comment":
      return createComment(
        client,
        requireString(params.doc_token, "doc_token"),
        requireString(params.content, "content"),
      );
    case "get_comment":
      return getComment(
        client,
        requireString(params.doc_token, "doc_token"),
        requireString(params.comment_id, "comment_id"),
      );
    case "list_comment_replies":
      return listCommentReplies(
        client,
        requireString(params.doc_token, "doc_token"),
        requireString(params.comment_id, "comment_id"),
        params.page_token,
        params.page_size,
      );
    case "create_diagram":
      return createDiagram(
        client,
        requireString(params.doc_token, "doc_token"),
        requireString(params.content, "content"),
      );
    default:
      return { error: `Unknown action: ${(params as any).action}` };
  }
}
