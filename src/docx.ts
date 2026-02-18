import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type * as Lark from "@larksuiteoapi/node-sdk";
import { FeishuDocSchema, type FeishuDocParams } from "./doc-schema.js";
import { appendDoc, createAndWriteDoc, createDoc, writeDoc } from "./doc-write-service.js";
import { hasFeishuToolEnabledForAnyAccount, withFeishuToolClient } from "./tools-common/tool-exec.js";

// ============ Helpers ============

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

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

// ============ Actions ============

async function readDoc(client: Lark.Client, docToken: string) {
  const [contentRes, infoRes, blocksRes] = await Promise.all([
    client.docx.document.rawContent({ path: { document_id: docToken } }),
    client.docx.document.get({ path: { document_id: docToken } }),
    client.docx.documentBlock.list({ path: { document_id: docToken } }),
  ]);

  if (contentRes.code !== 0) throw new Error(contentRes.msg);

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

async function updateBlock(
  client: Lark.Client,
  docToken: string,
  blockId: string,
  content: string,
) {
  const blockInfo = await client.docx.documentBlock.get({
    path: { document_id: docToken, block_id: blockId },
  });
  if (blockInfo.code !== 0) throw new Error(blockInfo.msg);

  const res = await client.docx.documentBlock.patch({
    path: { document_id: docToken, block_id: blockId },
    data: {
      update_text_elements: {
        elements: [{ text_run: { content } }],
      },
    },
  });
  if (res.code !== 0) throw new Error(res.msg);

  return { success: true, block_id: blockId };
}

async function deleteBlock(client: Lark.Client, docToken: string, blockId: string) {
  const blockInfo = await client.docx.documentBlock.get({
    path: { document_id: docToken, block_id: blockId },
  });
  if (blockInfo.code !== 0) throw new Error(blockInfo.msg);

  const parentId = blockInfo.data?.block?.parent_id ?? docToken;

  const children = await client.docx.documentBlockChildren.get({
    path: { document_id: docToken, block_id: parentId },
  });
  if (children.code !== 0) throw new Error(children.msg);

  const items = children.data?.items ?? [];
  const index = items.findIndex((item: any) => item.block_id === blockId);
  if (index === -1) throw new Error("Block not found");

  const res = await client.docx.documentBlockChildren.batchDelete({
    path: { document_id: docToken, block_id: parentId },
    data: { start_index: index, end_index: index + 1 },
  });
  if (res.code !== 0) throw new Error(res.msg);

  return { success: true, deleted_block_id: blockId };
}

async function listBlocks(client: Lark.Client, docToken: string) {
  const res = await client.docx.documentBlock.list({
    path: { document_id: docToken },
  });
  if (res.code !== 0) throw new Error(res.msg);

  return {
    blocks: res.data?.items ?? [],
  };
}

async function getBlock(client: Lark.Client, docToken: string, blockId: string) {
  const res = await client.docx.documentBlock.get({
    path: { document_id: docToken, block_id: blockId },
  });
  if (res.code !== 0) throw new Error(res.msg);

  return {
    block: res.data?.block,
  };
}

async function listAppScopes(client: Lark.Client) {
  const res = await client.application.scope.list({});
  if (res.code !== 0) throw new Error(res.msg);

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
 * Builds comment content structure from plain text
 * @param content Comment text content
 * @returns Formatted comment content for Feishu API
 */
function buildCommentContent(content: string) {
  return {
    elements: [
      {
        text_run: { text: content },
        type: "text_run",
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

/**
 * Lists all comments for a document with pagination support
 * @param client Feishu API client
 * @param docToken Document token
 * @param pageToken Page token for pagination
 * @param pageSize Page size (default: Feishu API default)
 * @returns Comments list with pagination info
 */
async function listComments(client: Lark.Client, docToken: string, pageToken?: string, pageSize?: number) {
  const normalizedPageSize = normalizePageSize(pageSize);
  const res = await (client as any).drive.fileComment.list({
    path: { file_token: docToken },
    params: {
      file_type: "docx",
      page_token: pageToken,
      page_size: normalizedPageSize,
    },
  });

  if (res.code !== 0) throw new Error(res.msg || "Failed to list comments");

  return {
    comments: Array.isArray(res.data?.items) ? res.data.items : [],
    page_token: res.data?.page_token,
    has_more: Boolean(res.data?.has_more),
  };
}

/**
 * Creates a new comment on a document
 * @param client Feishu API client
 * @param docToken Document token
 * @param content Comment text content
 * @returns Created comment information
 */
async function createComment(client: Lark.Client, docToken: string, content: string) {
  const res = await (client as any).drive.fileComment.create({
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
  });

  if (res.code !== 0) throw new Error(res.msg || "Failed to create comment");

  if (!res.data?.comment_id) {
    throw new Error("Comment creation failed: No comment ID returned");
  }

  return {
    comment_id: res.data.comment_id,
    comment: res.data,
  };
}

/**
 * Gets a single comment by ID
 * @param client Feishu API client
 * @param docToken Document token
 * @param commentId Comment ID to retrieve
 * @returns Comment details
 */
async function getComment(client: Lark.Client, docToken: string, commentId: string) {
  const res = await (client as any).drive.fileComment.get({
    path: { file_token: docToken, comment_id: commentId },
    params: {
      file_type: "docx",
    },
  });

  if (res.code !== 0) throw new Error(res.msg || "Failed to get comment");

  if (!res.data) {
    throw new Error(`Comment not found: ${commentId}`);
  }

  return {
    comment: res.data,
  };
}

/**
 * Lists all replies to a specific comment with pagination support
 * @param client Feishu API client
 * @param docToken Document token
 * @param commentId Comment ID to list replies for
 * @param pageToken Page token for pagination
 * @param pageSize Page size (default: Feishu API default)
 * @returns Replies list with pagination info
 */
async function listCommentReplies(client: Lark.Client, docToken: string, commentId: string, pageToken?: string, pageSize?: number) {
  const normalizedPageSize = normalizePageSize(pageSize);
  const res = await (client as any).drive.fileCommentReply.list({
    path: { file_token: docToken, comment_id: commentId },
    params: {
      file_type: "docx",
      page_token: pageToken,
      page_size: normalizedPageSize,
    },
  });

  if (res.code !== 0) throw new Error(res.msg || "Failed to list comment replies");

  return {
    replies: Array.isArray(res.data?.items) ? res.data.items : [],
    page_token: res.data?.page_token,
    has_more: Boolean(res.data?.has_more),
  };
}

// ============ Tool Registration ============

export function registerFeishuDocTools(api: OpenClawPluginApi) {
  if (!api.config) {
    api.logger.debug?.("feishu_doc: No config available, skipping doc tools");
    return;
  }

  if (!hasFeishuToolEnabledForAnyAccount(api.config)) {
    api.logger.debug?.("feishu_doc: No Feishu accounts configured, skipping doc tools");
    return;
  }

  // Registration happens once; account selection happens per execute() call.
  const docEnabled = hasFeishuToolEnabledForAnyAccount(api.config, "doc");
  const scopesEnabled = hasFeishuToolEnabledForAnyAccount(api.config, "scopes");
  const registered: string[] = [];

  // Main document tool with action-based dispatch
  if (docEnabled) {
    api.registerTool(
      {
        name: "feishu_doc",
        label: "Feishu Doc",
        description:
          'Feishu document operations. Actions: read, write, append, create, create_and_write, list_blocks, get_block, update_block, delete_block, list_comments, create_comment, get_comment, list_comment_replies. Use "create_and_write" for atomic create + content write.',
        parameters: FeishuDocSchema,
        async execute(_toolCallId, params) {
          const p = params as FeishuDocParams;
          try {
            return await withFeishuToolClient({
              api,
              toolName: "feishu_doc",
              requiredTool: "doc",
              run: async ({ client, account }) => {
                const mediaMaxBytes = (account.config?.mediaMaxMb ?? 30) * 1024 * 1024;
                switch (p.action) {
                  case "read":
                    return json(await readDoc(client, p.doc_token));
                  case "write":
                    return json(await writeDoc(client, p.doc_token, p.content, mediaMaxBytes));
                  case "append":
                    return json(await appendDoc(client, p.doc_token, p.content, mediaMaxBytes));
                  case "create":
                    return json(await createDoc(client, p.title, p.folder_token));
                  case "create_and_write":
                    return json(
                      await createAndWriteDoc(
                        client,
                        p.title,
                        p.content,
                        mediaMaxBytes,
                        p.folder_token,
                      ),
                    );
                  case "list_blocks":
                    return json(await listBlocks(client, p.doc_token));
                  case "get_block":
                    return json(await getBlock(client, p.doc_token, p.block_id));
                  case "update_block":
                    return json(await updateBlock(client, p.doc_token, p.block_id, p.content));
                  case "delete_block":
                    return json(await deleteBlock(client, p.doc_token, p.block_id));
                  case "list_comments":
                    return json(await listComments(client, p.doc_token, p.page_token, p.page_size));
                  case "create_comment":
                    return json(await createComment(client, p.doc_token, p.content));
                  case "get_comment":
                    return json(await getComment(client, p.doc_token, p.comment_id));
                  case "list_comment_replies":
                    return json(await listCommentReplies(client, p.doc_token, p.comment_id, p.page_token, p.page_size));
                  default:
                    return json({ error: `Unknown action: ${(p as any).action}` });
                }
              },
            });
          } catch (err) {
            return json({ error: err instanceof Error ? err.message : String(err) });
          }
        },
      },
      { name: "feishu_doc" },
    );
    registered.push("feishu_doc");
  }

  // Keep feishu_app_scopes as independent tool
  if (scopesEnabled) {
    api.registerTool(
      {
        name: "feishu_app_scopes",
        label: "Feishu App Scopes",
        description:
          "List current app permissions (scopes). Use to debug permission issues or check available capabilities.",
        parameters: Type.Object({}),
        async execute() {
          try {
            const result = await withFeishuToolClient({
              api,
              toolName: "feishu_app_scopes",
              requiredTool: "scopes",
              run: async ({ client }) => listAppScopes(client),
            });
            return json(result);
          } catch (err) {
            return json({ error: err instanceof Error ? err.message : String(err) });
          }
        },
      },
      { name: "feishu_app_scopes" },
    );
    registered.push("feishu_app_scopes");
  }

  if (registered.length > 0) {
    api.logger.debug?.(`feishu_doc: Registered ${registered.join(", ")}`);
  }
}
