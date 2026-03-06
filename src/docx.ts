import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createFeishuClient } from "./client.js";
import { resolveFeishuAccount, listEnabledFeishuAccounts } from "./accounts.js";
import type * as Lark from "@larksuiteoapi/node-sdk";
import { Readable } from "stream";
import { FeishuDocSchema, type FeishuDocParams } from "./doc-schema.js";
import { resolveToolsConfig } from "./tools-config.js";
import { getCurrentSenderOpenId } from "./session-context.js";
import fs from 'fs';

const DEBUG_LOG_FILE = '/tmp/feishu_debug.log';

function writeDebugLog(message: string, data?: any): void {
  try {
    const timestamp = new Date().toISOString();
    const logEntry = data ? `[${timestamp}] ${message} ${JSON.stringify(data)}\n` : `[${timestamp}] ${message}\n`;
    fs.appendFileSync(DEBUG_LOG_FILE, logEntry);
  } catch (err) {
    // Ignore file write errors
  }
}

// Logger for debugging
let feishuDocLogger: OpenClawPluginApi["logger"] | undefined;

export function setFeishuDocLogger(logger: OpenClawPluginApi["logger"]) {
  feishuDocLogger = logger;
}

// ============ Helpers ============

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

/** Extract image URLs from markdown content */
function extractImageUrls(markdown: string): string[] {
  const regex = /!\[[^\]]*\]\(([^)]+)\)/g;
  const urls: string[] = [];
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    const url = match[1].trim();
    if (url.startsWith("http://") || url.startsWith("https://")) {
      urls.push(url);
    }
  }
  return urls;
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

// Block types that cannot be created via documentBlockChildren.create API
const UNSUPPORTED_CREATE_TYPES = new Set([31, 32]);

/** Clean blocks for insertion (remove unsupported types and read-only fields) */
function cleanBlocksForInsert(blocks: any[]): { cleaned: any[]; skipped: string[] } {
  const skipped: string[] = [];
  const cleaned = blocks
    .filter((block) => {
      if (UNSUPPORTED_CREATE_TYPES.has(block.block_type)) {
        const typeName = BLOCK_TYPE_NAMES[block.block_type] || `type_${block.block_type}`;
        skipped.push(typeName);
        return false;
      }
      return true;
    })
    .map((block) => {
      if (block.block_type === 31 && block.table?.merge_info) {
        const { merge_info, ...tableRest } = block.table;
        return { ...block, table: tableRest };
      }
      return block;
    });
  return { cleaned, skipped };
}

// ============ Core Functions ============

async function convertMarkdown(client: Lark.Client, markdown: string) {
  const res = await client.docx.document.convert({
    data: { content_type: "markdown", content: markdown },
  });
  if (res.code !== 0) throw new Error(res.msg);
  return {
    blocks: res.data?.blocks ?? [],
    firstLevelBlockIds: res.data?.first_level_block_ids ?? [],
  };
}

async function insertBlocks(
  client: Lark.Client,
  docToken: string,
  blocks: any[],
  parentBlockId?: string,
): Promise<{ children: any[]; skipped: string[] }> {
  const { cleaned, skipped } = cleanBlocksForInsert(blocks);
  const blockId = parentBlockId ?? docToken;

  if (cleaned.length === 0) {
    return { children: [], skipped };
  }

  const res = await client.docx.documentBlockChildren.create({
    path: { document_id: docToken, block_id: blockId },
    data: { children: cleaned },
  });
  if (res.code !== 0) throw new Error(res.msg);
  return { children: res.data?.children ?? [], skipped };
}

async function clearDocumentContent(client: Lark.Client, docToken: string) {
  const existing = await client.docx.documentBlock.list({
    path: { document_id: docToken },
  });
  if (existing.code !== 0) throw new Error(existing.msg);

  const childIds =
    existing.data?.items
      ?.filter((b) => b.parent_id === docToken && b.block_type !== 1)
      .map((b) => b.block_id) ?? [];

  if (childIds.length > 0) {
    const res = await client.docx.documentBlockChildren.batchDelete({
      path: { document_id: docToken, block_id: docToken },
      data: { start_index: 0, end_index: childIds.length },
    });
    if (res.code !== 0) throw new Error(res.msg);
  }

  return childIds.length;
}

async function uploadImageToDocx(
  client: Lark.Client,
  blockId: string,
  imageBuffer: Buffer,
  fileName: string,
): Promise<string> {
  const res = await client.drive.media.uploadAll({
    data: {
      file_name: fileName,
      parent_type: "docx_image",
      parent_node: blockId,
      size: imageBuffer.length,
      file: Readable.from(imageBuffer) as any,
    },
  });

  const fileToken = res?.file_token;
  if (!fileToken) {
    throw new Error("Image upload failed: no file_token returned");
  }
  return fileToken;
}

async function downloadImage(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function processImages(
  client: Lark.Client,
  docToken: string,
  markdown: string,
  insertedBlocks: any[],
): Promise<number> {
  const imageUrls = extractImageUrls(markdown);
  if (imageUrls.length === 0) return 0;

  const imageBlocks = insertedBlocks.filter((b) => b.block_type === 27);

  let processed = 0;
  for (let i = 0; i < Math.min(imageUrls.length, imageBlocks.length); i++) {
    const url = imageUrls[i];
    const blockId = imageBlocks[i].block_id;

    try {
      const buffer = await downloadImage(url);
      const urlPath = new URL(url).pathname;
      const fileName = urlPath.split("/").pop() || `image_${i}.png`;
      const fileToken = await uploadImageToDocx(client, blockId, buffer, fileName);

      await client.docx.documentBlock.patch({
        path: { document_id: docToken, block_id: blockId },
        data: {
          replace_image: { token: fileToken },
        },
      });

      processed++;
    } catch (err) {
      console.error(`Failed to process image ${url}:`, err);
    }
  }

  return processed;
}

// ============ Actions ============

const STRUCTURED_BLOCK_TYPES = new Set([14, 18, 21, 23, 27, 30, 31, 32]);

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

async function createDoc(client: Lark.Client, title: string, folderToken?: string, shareWith?: {
  member_type: string;
  member_id: string;
  perm: string;
}, content?: string) {
  writeDebugLog(`[feishu_doc] createDoc called`, { title, folderToken, shareWith, hasContent: !!content });
  const res = await client.docx.document.create({
    data: { title, folder_token: folderToken },
  });
  if (res.code !== 0) throw new Error(res.msg);
  const doc = res.data?.document;
  writeDebugLog(`[feishu_doc] Document created`, { document_id: doc?.document_id, title: doc?.title });

  // If no shareWith specified, try to auto-share with current user
  let effectiveShareWith = shareWith;
  if (!effectiveShareWith) {
    const currentSenderOpenId = getCurrentSenderOpenId();
    writeDebugLog(`[feishu_doc] getCurrentSenderOpenId returned`, currentSenderOpenId);
    feishuDocLogger?.info?.(`[feishu_doc] getCurrentSenderOpenId returned:`, currentSenderOpenId);
    if (currentSenderOpenId) {
      effectiveShareWith = {
        member_type: "openid",
        member_id: currentSenderOpenId,
        perm: "edit",
      };
      writeDebugLog(`[feishu_doc] Auto-sharing with current user`, currentSenderOpenId);
      feishuDocLogger?.info?.(`[feishu_doc] Auto-sharing with current user:`, currentSenderOpenId);
    } else {
      writeDebugLog(`[feishu_doc] No current user found, skipping auto-share`);
      feishuDocLogger?.warn?.(`[feishu_doc] No current user found, skipping auto-share`);
    }
  }

  // Auto-share with specified user or current user
  if (effectiveShareWith && doc?.document_id) {
    try {
      writeDebugLog(`[feishu_doc] Sharing document`, { document_id: doc.document_id, member_id: effectiveShareWith.member_id, perm: effectiveShareWith.perm });
      feishuDocLogger?.info?.(`[feishu_doc] Sharing document ${doc.document_id} with ${effectiveShareWith.member_id} (${effectiveShareWith.perm})`);
      await client.drive.permissionMember.create({
        path: { token: doc.document_id },
        params: { type: "docx", need_notification: false },
        data: {
          member_type: effectiveShareWith.member_type as any,
          member_id: effectiveShareWith.member_id,
          perm: effectiveShareWith.perm as any,
        },
      });
      writeDebugLog(`[feishu_doc] Successfully shared document`);
      feishuDocLogger?.info?.(`[feishu_doc] Successfully shared document`);
    } catch (err) {
      writeDebugLog(`[feishu_doc] Failed to share document`, { error: String(err) });
      feishuDocLogger?.error?.(`Failed to share document with ${effectiveShareWith.member_id}:`, err);
      // Don't throw - document was created successfully, just sharing failed
    }
  } else {
    writeDebugLog(`[feishu_doc] No sharing performed`, { effectiveShareWith: !!effectiveShareWith, document_id: doc?.document_id });
    feishuDocLogger?.info?.(`[feishu_doc] No sharing performed - effectiveShareWith:`, effectiveShareWith, `doc.document_id:`, doc?.document_id);
  }

  // If content is provided, write it to the document
  let writeResult;
  if (content && doc?.document_id) {
    writeDebugLog(`[feishu_doc] Writing content to document`, { contentLength: content.length });
    try {
      writeResult = await writeDoc(client, doc.document_id, content);
      writeDebugLog(`[feishu_doc] Content written successfully`, writeResult);
    } catch (err) {
      writeDebugLog(`[feishu_doc] Failed to write content`, { error: String(err) });
      feishuDocLogger?.error?.(`Failed to write content to document:`, err);
      // Don't throw - document was created successfully, just content write failed
    }
  }

  return {
    document_id: doc?.document_id,
    title: doc?.title,
    url: `https://feishu.cn/docx/${doc?.document_id}`,
    ...(effectiveShareWith && { shared_with: { ...effectiveShareWith } }),
    ...(writeResult && { content_written: writeResult }),
  };
}

async function createDocWithContent(
  client: Lark.Client,
  title: string,
  content: string,
  folderToken?: string,
  shareWith?: {
    member_type: string;
    member_id: string;
    perm: string;
  }
) {
  // Create the document first
  const createResult = await createDoc(client, title, folderToken, shareWith);
  const documentId = createResult.document_id;

  if (!documentId) {
    throw new Error("Failed to create document: no document_id returned");
  }

  // Write content to the document
  const writeResult = await writeDoc(client, documentId, content);

  return {
    document_id: documentId,
    title: createResult.title,
    url: createResult.url,
    content_written: writeResult,
  };
}

async function writeDoc(client: Lark.Client, docToken: string, markdown: string) {
  const deleted = await clearDocumentContent(client, docToken);

  const { blocks } = await convertMarkdown(client, markdown);
  if (blocks.length === 0) {
    return { success: true, blocks_deleted: deleted, blocks_added: 0, images_processed: 0 };
  }

  const { children: inserted, skipped } = await insertBlocks(client, docToken, blocks);
  const imagesProcessed = await processImages(client, docToken, markdown, inserted);

  return {
    success: true,
    blocks_deleted: deleted,
    blocks_added: inserted.length,
    images_processed: imagesProcessed,
    ...(skipped.length > 0 && {
      warning: `Skipped unsupported block types: ${skipped.join(", ")}. Tables are not supported via this API.`,
    }),
  };
}

async function appendDoc(client: Lark.Client, docToken: string, markdown: string) {
  const { blocks } = await convertMarkdown(client, markdown);
  if (blocks.length === 0) {
    throw new Error("Content is empty");
  }

  const { children: inserted, skipped } = await insertBlocks(client, docToken, blocks);
  const imagesProcessed = await processImages(client, docToken, markdown, inserted);

  return {
    success: true,
    blocks_added: inserted.length,
    images_processed: imagesProcessed,
    block_ids: inserted.map((b: any) => b.block_id),
    ...(skipped.length > 0 && {
      warning: `Skipped unsupported block types: ${skipped.join(", ")}. Tables are not supported via this API.`,
    }),
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

// ============ Tool Registration ============

export function registerFeishuDocTools(api: OpenClawPluginApi) {
  if (!api.config) {
    api.logger.debug?.("feishu_doc: No config available, skipping doc tools");
    return;
  }

  // Check if any account is configured
  const accounts = listEnabledFeishuAccounts(api.config);
  if (accounts.length === 0) {
    api.logger.debug?.("feishu_doc: No Feishu accounts configured, skipping doc tools");
    return;
  }

  // Use first account's config for tools configuration
  const firstAccount = accounts[0];
  const toolsCfg = resolveToolsConfig(firstAccount.config.tools);

  // Set logger for debugging
  setFeishuDocLogger(api.logger);

  // Helper to get client for the default account
  const getClient = () => createFeishuClient(firstAccount);
  const registered: string[] = [];

  // Main document tool with action-based dispatch
  if (toolsCfg.doc) {
    api.registerTool(
    {
      name: "feishu_doc",
      label: "Feishu Doc",
      description:
        "Feishu document operations. Actions:\n" +
        "- create: Creates a document with optional content (use content parameter to add content)\n" +
        "- read: Reads document content and metadata\n" +
        "- write: Replaces entire document content with markdown\n" +
        "- append: Appends markdown content to end of document\n" +
        "- list_blocks: Lists all blocks in the document\n" +
        "- get_block: Gets details of a specific block\n" +
        "- update_block: Updates text content of a specific block\n" +
        "- delete_block: Deletes a specific block\n" +
        "- create_with_content: Alias for 'create' with content parameter (deprecated, use 'create' with content parameter instead)",
      parameters: FeishuDocSchema,
      async execute(_toolCallId, params) {
        const p = params as FeishuDocParams;
        writeDebugLog(`[feishu_doc] Tool execute called`, { action: p.action, params: p });
        try {
          const client = getClient();
          switch (p.action) {
            case "read":
              writeDebugLog(`[feishu_doc] Executing read action`, { doc_token: p.doc_token });
              return json(await readDoc(client, p.doc_token));
            case "write":
              writeDebugLog(`[feishu_doc] Executing write action`, { doc_token: p.doc_token, content_length: p.content?.length });
              return json(await writeDoc(client, p.doc_token, p.content));
            case "append":
              writeDebugLog(`[feishu_doc] Executing append action`, { doc_token: p.doc_token, content_length: p.content?.length });
              return json(await appendDoc(client, p.doc_token, p.content));
            case "create":
              writeDebugLog(`[feishu_doc] Executing create action`, { title: p.title, folder_token: p.folder_token, share_with: (p as any).share_with, hasContent: !!(p as any).content });
              return json(await createDoc(client, p.title, p.folder_token, (p as any).share_with, (p as any).content));
            case "create_with_content":
              writeDebugLog(`[feishu_doc] Executing create_with_content action`, { title: p.title, content_length: (p as any).content?.length, folder_token: p.folder_token, share_with: (p as any).share_with });
              return json(await createDocWithContent(client, p.title, (p as any).content, p.folder_token, (p as any).share_with));
            case "list_blocks":
              return json(await listBlocks(client, p.doc_token));
            case "get_block":
              return json(await getBlock(client, p.doc_token, p.block_id));
            case "update_block":
              return json(await updateBlock(client, p.doc_token, p.block_id, p.content));
            case "delete_block":
              return json(await deleteBlock(client, p.doc_token, p.block_id));
            default:
              writeDebugLog(`[feishu_doc] Unknown action`, { action: (p as any).action });
              return json({ error: `Unknown action: ${(p as any).action}` });
          }
        } catch (err) {
          writeDebugLog(`[feishu_doc] Error during execution`, { error: String(err), action: p.action });
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    { name: "feishu_doc" },
  );
    registered.push("feishu_doc");
  }

  // Keep feishu_app_scopes as independent tool
  if (toolsCfg.scopes) {
    api.registerTool(
    {
      name: "feishu_app_scopes",
      label: "Feishu App Scopes",
      description:
        "List current app permissions (scopes). Use to debug permission issues or check available capabilities.",
      parameters: Type.Object({}),
      async execute() {
        try {
          const result = await listAppScopes(getClient());
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
    api.logger.info?.(`feishu_doc: Registered ${registered.join(", ")}`);
  }
}
