import type * as Lark from "@larksuiteoapi/node-sdk";
import { Readable } from "stream";
import { getFeishuRuntime } from "./runtime.js";

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
const UNSUPPORTED_CREATE_TYPES = new Set([32]);

// Maximum content length for a single API call (empirical value based on Feishu API limits)
const MAX_CONTENT_LENGTH = 50000; // ~50KB
const MAX_BLOCKS_PER_INSERT = 50; // Maximum blocks per insert API call

export type CreateDocResult = {
  document_id?: string;
  title?: string;
  url: string;
};

export type WriteDocResult = {
  success: true;
  blocks_deleted: number;
  blocks_added: number;
  images_processed: number;
  warning?: string;
};

export type AppendDocResult = {
  success: true;
  blocks_added: number;
  images_processed: number;
  block_ids: string[];
  warning?: string;
};

export type CreateAndWriteDocResult = {
  success: true;
  document_id: string;
  title: string;
  url: string;
  import_method: "create_and_write";
  blocks_added: number;
  images_processed: number;
  warning?: string;
};

type InsertResult = { children: any[]; skipped: string[]; warnings: string[] };

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

/**
 * Reorder blocks according to firstLevelBlockIds from convertMarkdown API.
 * The API returns blocks as a flat unordered array across all levels.
 * firstLevelBlockIds provides the correct top-level document order.
 */
function reorderBlocks(blocks: any[], firstLevelBlockIds: string[]): any[] {
  if (!firstLevelBlockIds || firstLevelBlockIds.length === 0) return blocks;

  const blockMap = new Map<string, any>();
  for (const block of blocks) {
    if (block.block_id) {
      blockMap.set(block.block_id, block);
    }
  }

  const ordered: any[] = [];
  for (const id of firstLevelBlockIds) {
    const block = blockMap.get(id);
    if (block) {
      ordered.push(block);
    }
  }

  // If mapping unexpectedly fails, fall back to original to avoid hard data loss.
  return ordered.length > 0 ? ordered : blocks;
}

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
      const cleanedBlock = { ...block };
      delete cleanedBlock.block_id;
      delete cleanedBlock.parent_id;
      delete cleanedBlock.children;

      // Table cell IDs and merge metadata are not accepted in create payload.
      if (cleanedBlock.block_type === 31 && cleanedBlock.table) {
        const property = cleanedBlock.table.property ?? {};
        const { merge_info, ...propertyRest } = property;
        cleanedBlock.table = { property: propertyRest };
      }

      return cleanedBlock;
    });
  return { cleaned, skipped };
}

function buildBlockMap(blocks: any[]): Map<string, any> {
  const map = new Map<string, any>();
  for (const block of blocks) {
    if (block.block_id) map.set(block.block_id, block);
  }
  return map;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Known transient/throughput-related Feishu codes observed across endpoints.
// Code matching is primary; message matching is fallback for undocumented new codes.
const RETRYABLE_CREATE_ERROR_CODES = new Set<number>([
  429, // HTTP-like throttle surfaces in some SDK wrappers
  1254290, // Too many requests
  1254291, // Write conflict
  1255040, // Request timeout
]);

const RETRYABLE_MESSAGE_PATTERNS = [
  /\brate\b/i,
  /\bfrequency\b/i,
  /\btoo many\b/i,
  /\blimit\b/i,
  /\bqps\b/i,
  /频率/u,
  /限流/u,
];

function isRetryableCreateError(code?: number, msg?: string) {
  if (!code || code === 0) return false;
  if (RETRYABLE_CREATE_ERROR_CODES.has(code)) return true;
  const text = msg ?? "";
  return RETRYABLE_MESSAGE_PATTERNS.some((pattern) => pattern.test(text));
}

const CREATE_CHILDREN_RETRY_POLICY = {
  maxAttempts: 4,
  baseDelayMs: 250,
  maxDelayMs: 2500,
  jitterRatio: 0.2,
} as const;

function computeBackoffDelayMs(attempt: number, policy = CREATE_CHILDREN_RETRY_POLICY) {
  const exp = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  const jitter = exp * policy.jitterRatio;
  const min = Math.max(0, exp - jitter);
  const max = exp + jitter;
  return Math.round(min + Math.random() * (max - min));
}

type CreateChildrenPayload = Parameters<Lark.Client["docx"]["documentBlockChildren"]["create"]>[0];
type CreateChildrenResponse = Awaited<
  ReturnType<Lark.Client["docx"]["documentBlockChildren"]["create"]>
>;

async function executeWithBackoff<T>(args: {
  operationName: string;
  operation: () => Promise<T>;
  isSuccess: (result: T) => boolean;
  shouldRetry: (result: T) => boolean;
  getMessage: (result: T) => string | undefined;
  policy?: typeof CREATE_CHILDREN_RETRY_POLICY;
}): Promise<T> {
  const policy = args.policy ?? CREATE_CHILDREN_RETRY_POLICY;
  let lastResult: T | undefined;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    const result = await args.operation();
    lastResult = result;

    if (args.isSuccess(result)) return result;
    if (!args.shouldRetry(result) || attempt === policy.maxAttempts) return result;

    const delayMs = computeBackoffDelayMs(attempt, policy);
    const msg = args.getMessage(result) ?? "unknown error";
    console.warn(
      `[feishu_doc] ${args.operationName} retry ${attempt}/${policy.maxAttempts - 1} after ${delayMs}ms: ${msg}`,
    );
    await sleep(delayMs);
  }

  return lastResult!;
}

async function createChildrenWithRetry(
  client: Lark.Client,
  payload: CreateChildrenPayload,
  policy = CREATE_CHILDREN_RETRY_POLICY,
) {
  return executeWithBackoff<CreateChildrenResponse>({
    operationName: "docx.documentBlockChildren.create",
    operation: () => client.docx.documentBlockChildren.create(payload),
    isSuccess: (res) => res.code === 0,
    shouldRetry: (res) => isRetryableCreateError(res.code, res.msg),
    getMessage: (res) => res.msg,
    policy,
  });
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

  const res = await createChildrenWithRetry(client, {
    path: { document_id: docToken, block_id: blockId },
    data: { children: cleaned },
  });
  if (res.code !== 0) throw new Error(res.msg);
  return { children: res.data?.children ?? [], skipped };
}

async function insertTableWithCells(
  client: Lark.Client,
  docToken: string,
  tableBlock: any,
  blockMap: Map<string, any>,
  parentBlockId?: string,
): Promise<InsertResult> {
  const tableInsert = await insertBlocks(client, docToken, [tableBlock], parentBlockId);
  const insertedTable = tableInsert.children[0];

  if (!insertedTable || insertedTable.block_type !== 31) {
    return {
      children: tableInsert.children,
      skipped: tableInsert.skipped,
      warnings: ["Table block was not returned after create; skipped table cell content."],
    };
  }

  const srcCells: string[] = tableBlock.table?.cells ?? [];
  const dstCells: string[] = insertedTable.table?.cells ?? [];
  if (srcCells.length === 0) {
    return { children: tableInsert.children, skipped: tableInsert.skipped, warnings: [] };
  }

  if (dstCells.length === 0) {
    return {
      children: tableInsert.children,
      skipped: tableInsert.skipped,
      warnings: ["Table created but API did not return generated cells; table content may be empty."],
    };
  }

  const copiedChildren: any[] = [];
  const allSkipped = [...tableInsert.skipped];
  const warnings: string[] = [];
  let sourceCellsWithContent = 0;
  let copiedCellCount = 0;

  const cellCount = Math.min(srcCells.length, dstCells.length);
  for (let i = 0; i < cellCount; i++) {
    const srcCellId = srcCells[i];
    const dstCellId = dstCells[i];
    const srcCell = blockMap.get(srcCellId);
    const srcChildIds: string[] = srcCell?.children ?? [];
    let srcChildBlocks = srcChildIds.map((id) => blockMap.get(id)).filter((b): b is any => Boolean(b));

    // Some convert payloads may carry plain text directly on table_cell.
    if (srcChildBlocks.length === 0 && srcCell?.text?.elements?.length) {
      srcChildBlocks = [{ block_type: 2, text: srcCell.text }];
    }
    if (srcChildBlocks.length === 0 && srcCell?.table_cell?.text?.elements?.length) {
      srcChildBlocks = [{ block_type: 2, text: srcCell.table_cell.text }];
    }

    if (srcChildBlocks.length === 0) continue;
    sourceCellsWithContent++;

    const cellInsert = await insertBlocksInBatches(client, docToken, srcChildBlocks, dstCellId);
    copiedChildren.push(...cellInsert.children);
    allSkipped.push(...cellInsert.skipped);
    if (cellInsert.children.length > 0) copiedCellCount++;
  }

  if (srcCells.length !== dstCells.length) {
    warnings.push(
      `Table cell count mismatch after create (source=${srcCells.length}, target=${dstCells.length}); content may be partially copied.`,
    );
  }
  if (sourceCellsWithContent > 0 && copiedCellCount < sourceCellsWithContent) {
    warnings.push(
      `Copied table cell content for ${copiedCellCount}/${sourceCellsWithContent} non-empty cells.`,
    );
  }

  return {
    children: [...tableInsert.children, ...copiedChildren],
    skipped: [...new Set(allSkipped)],
    warnings,
  };
}

/**
 * Insert blocks in batches to avoid API limits.
 */
async function insertBlocksInBatches(
  client: Lark.Client,
  docToken: string,
  blocks: any[],
  parentBlockId?: string,
): Promise<{ children: any[]; skipped: string[] }> {
  const allInserted: any[] = [];
  const allSkipped: string[] = [];
  const blockId = parentBlockId ?? docToken;

  for (let i = 0; i < blocks.length; i += MAX_BLOCKS_PER_INSERT) {
    const batch = blocks.slice(i, i + MAX_BLOCKS_PER_INSERT);
    const { cleaned, skipped } = cleanBlocksForInsert(batch);
    allSkipped.push(...skipped);

    if (cleaned.length === 0) {
      continue;
    }

    try {
      const res = await createChildrenWithRetry(client, {
        path: { document_id: docToken, block_id: blockId },
        data: { children: cleaned },
      });

      if (res.code !== 0) {
        // If batch insert fails, try inserting one by one.
        console.warn(`[feishu_doc] Batch insert failed: ${res.msg}. Trying individual inserts...`);
        for (const block of cleaned) {
          try {
            const singleRes = await createChildrenWithRetry(client, {
              path: { document_id: docToken, block_id: blockId },
              data: { children: [block] },
            });
            if (singleRes.code === 0) {
              allInserted.push(...(singleRes.data?.children ?? []));
            } else {
              console.error(`[feishu_doc] Failed to insert block: ${singleRes.msg}`);
            }
          } catch (err) {
            console.error(`[feishu_doc] Error inserting block:`, err);
          }
        }
      } else {
        allInserted.push(...(res.data?.children ?? []));
      }
    } catch (err) {
      console.error(`[feishu_doc] Error in batch insert:`, err);
      throw err;
    }
  }

  return { children: allInserted, skipped: [...new Set(allSkipped)] };
}

async function insertBlocksPreservingTables(
  client: Lark.Client,
  docToken: string,
  blocks: any[],
  blockMap: Map<string, any>,
  parentBlockId?: string,
): Promise<InsertResult> {
  const inserted: any[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];
  const buffer: any[] = [];

  const flushBuffer = async () => {
    if (buffer.length === 0) return;
    const res = await insertBlocksInBatches(client, docToken, buffer, parentBlockId);
    inserted.push(...res.children);
    skipped.push(...res.skipped);
    buffer.length = 0;
  };

  for (const block of blocks) {
    if (block.block_type === 31) {
      await flushBuffer();
      const tableRes = await insertTableWithCells(client, docToken, block, blockMap, parentBlockId);
      inserted.push(...tableRes.children);
      skipped.push(...tableRes.skipped);
      warnings.push(...tableRes.warnings);
      continue;
    }
    buffer.push(block);
  }

  await flushBuffer();

  return {
    children: inserted,
    skipped: [...new Set(skipped)],
    warnings: [...new Set(warnings)],
  };
}

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

async function downloadImage(url: string, maxBytes: number): Promise<Buffer> {
  const fetched = await getFeishuRuntime().channel.media.fetchRemoteMedia({ url, maxBytes });
  return fetched.buffer;
}

async function processImages(
  client: Lark.Client,
  docToken: string,
  markdown: string,
  insertedBlocks: any[],
  maxBytes: number,
): Promise<number> {
  const imageUrls = extractImageUrls(markdown);
  if (imageUrls.length === 0) return 0;

  const imageBlocks = insertedBlocks.filter((b) => b.block_type === 27);
  let processed = 0;

  for (let i = 0; i < Math.min(imageUrls.length, imageBlocks.length); i++) {
    const url = imageUrls[i];
    const blockId = imageBlocks[i].block_id;

    try {
      const buffer = await downloadImage(url, maxBytes);
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

function ensureBlocksInserted(args: {
  mode: "write" | "append";
  markdown: string;
  insertedCount: number;
  skipped: string[];
  warnings: string[];
}) {
  if (args.markdown.trim().length === 0) {
    return;
  }
  if (args.insertedCount > 0) {
    return;
  }

  const details: string[] = [];
  if (args.skipped.length > 0) details.push(`skipped=${args.skipped.join(", ")}`);
  if (args.warnings.length > 0) details.push(`warnings=${args.warnings.join(" | ")}`);
  const suffix = details.length > 0 ? ` (${details.join("; ")})` : "";
  throw new Error(
    `Document ${args.mode} produced zero inserted blocks for non-empty content${suffix}. Check markdown compatibility and granted scopes.`,
  );
}

export async function createDoc(
  client: Lark.Client,
  title: string,
  folderToken?: string,
): Promise<CreateDocResult> {
  const res = await client.docx.document.create({
    data: { title, folder_token: folderToken },
  });
  if (res.code !== 0) throw new Error(res.msg);
  const doc = res.data?.document;
  return {
    document_id: doc?.document_id,
    title: doc?.title,
    url: `https://feishu.cn/docx/${doc?.document_id}`,
  };
}

export async function writeDoc(
  client: Lark.Client,
  docToken: string,
  markdown: string,
  maxBytes: number,
): Promise<WriteDocResult> {
  const deleted = await clearDocumentContent(client, docToken);

  if (markdown.length > MAX_CONTENT_LENGTH) {
    console.warn(
      `[feishu_doc] Content length (${markdown.length}) exceeds recommended limit (${MAX_CONTENT_LENGTH}). May cause API errors.`,
    );
  }

  const { blocks, firstLevelBlockIds } = await convertMarkdown(client, markdown);
  if (blocks.length === 0) {
    if (markdown.trim().length > 0) {
      throw new Error("Markdown conversion returned no blocks for non-empty content.");
    }
    return { success: true, blocks_deleted: deleted, blocks_added: 0, images_processed: 0 };
  }

  const orderedBlocks = reorderBlocks(blocks, firstLevelBlockIds);
  const blockMap = buildBlockMap(blocks);
  const { children: inserted, skipped, warnings } = await insertBlocksPreservingTables(
    client,
    docToken,
    orderedBlocks,
    blockMap,
  );
  const imagesProcessed = await processImages(client, docToken, markdown, inserted, maxBytes);
  ensureBlocksInserted({
    mode: "write",
    markdown,
    insertedCount: inserted.length,
    skipped,
    warnings,
  });

  const warningParts: string[] = [];
  if (skipped.length > 0) {
    warningParts.push(`Skipped unsupported block types: ${skipped.join(", ")}.`);
  }
  if (warnings.length > 0) {
    warningParts.push(...warnings);
  }

  return {
    success: true,
    blocks_deleted: deleted,
    blocks_added: inserted.length,
    images_processed: imagesProcessed,
    ...(warningParts.length > 0 && {
      warning: warningParts.join(" "),
    }),
  };
}

export async function appendDoc(
  client: Lark.Client,
  docToken: string,
  markdown: string,
  maxBytes: number,
): Promise<AppendDocResult> {
  const { blocks, firstLevelBlockIds } = await convertMarkdown(client, markdown);
  if (blocks.length === 0) {
    throw new Error("Content is empty");
  }

  const orderedBlocks = reorderBlocks(blocks, firstLevelBlockIds);
  const blockMap = buildBlockMap(blocks);
  const { children: inserted, skipped, warnings } = await insertBlocksPreservingTables(
    client,
    docToken,
    orderedBlocks,
    blockMap,
  );
  const imagesProcessed = await processImages(client, docToken, markdown, inserted, maxBytes);
  ensureBlocksInserted({
    mode: "append",
    markdown,
    insertedCount: inserted.length,
    skipped,
    warnings,
  });

  const warningParts: string[] = [];
  if (skipped.length > 0) {
    warningParts.push(`Skipped unsupported block types: ${skipped.join(", ")}.`);
  }
  if (warnings.length > 0) {
    warningParts.push(...warnings);
  }

  return {
    success: true,
    blocks_added: inserted.length,
    images_processed: imagesProcessed,
    block_ids: inserted.map((b: any) => b.block_id),
    ...(warningParts.length > 0 && {
      warning: warningParts.join(" "),
    }),
  };
}

export async function createAndWriteDoc(
  client: Lark.Client,
  title: string,
  markdown: string,
  maxBytes: number,
  folderToken?: string,
): Promise<CreateAndWriteDocResult> {
  const created = await createDoc(client, title, folderToken);
  const docId = created.document_id;
  if (!docId) {
    throw new Error("Document created but no document_id returned");
  }

  const writeResult = await writeDoc(client, docId, markdown, maxBytes);
  return {
    success: true,
    document_id: docId,
    title: created.title ?? title,
    url: created.url,
    import_method: "create_and_write",
    blocks_added: writeResult.blocks_added,
    images_processed: writeResult.images_processed,
    ...(writeResult.warning && { warning: writeResult.warning }),
  };
}
