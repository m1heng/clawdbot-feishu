import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createFeishuClient } from "./client.js";
import type { FeishuConfig } from "./types.js";
import type * as Lark from "@larksuiteoapi/node-sdk";
import { Readable } from "stream";

// ============ Helpers ============

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

function extractBlockPreview(block: any): string {
  const elements =
    block.text?.elements ??
    block.heading1?.elements ??
    block.heading2?.elements ??
    block.heading3?.elements ??
    [];
  return elements
    .filter((e: any) => e.text_run)
    .map((e: any) => e.text_run.content)
    .join("")
    .slice(0, 50);
}

/** Extract image URLs from markdown content */
function extractImageUrls(markdown: string): string[] {
  const regex = /!\[[^\]]*\]\(([^)]+)\)/g;
  const urls: string[] = [];
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    const url = match[1].trim();
    // Only collect http(s) URLs, not file paths
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

// Block types that need special handling (not via standard documentBlockChildren.create)
const TABLE_BLOCK_TYPE = 31;
const TABLE_CELL_BLOCK_TYPE = 32;

/** Extracted table data from convert API result */
interface TableData {
  rowSize: number;
  colSize: number;
  cells: string[][]; // 2D array of cell text content
}

/** Extract table data from converted blocks (flat list with ID references) */
function extractTableFromBlocks(blocks: any[]): { tables: TableData[]; otherBlocks: any[] } {
  const tables: TableData[] = [];
  const otherBlocks: any[] = [];

  // Build a map of block_id -> block for quick lookup
  const blockMap = new Map<string, any>();
  for (const block of blocks) {
    if (block.block_id) {
      blockMap.set(block.block_id, block);
    }
  }

  // Track which blocks are part of tables (to exclude from otherBlocks)
  const tableRelatedIds = new Set<string>();

  for (const block of blocks) {
    if (block.block_type === TABLE_BLOCK_TYPE) {
      tableRelatedIds.add(block.block_id);

      const tableInfo = block.table;
      if (tableInfo) {
        const rowSize = tableInfo.property?.row_size ?? 0;
        const colSize = tableInfo.property?.column_size ?? 0;

        // Initialize cells array
        const cells: string[][] = Array.from({ length: rowSize }, () =>
          Array.from({ length: colSize }, () => ""),
        );

        // table.cells is a flat array of cell block IDs in row-major order
        const cellIds: string[] = tableInfo.cells ?? [];

        let cellIndex = 0;
        for (let row = 0; row < rowSize; row++) {
          for (let col = 0; col < colSize; col++) {
            if (cellIndex >= cellIds.length) break;

            const cellId = cellIds[cellIndex];
            tableRelatedIds.add(cellId);

            // Find the TableCell block
            const cellBlock = blockMap.get(cellId);
            if (cellBlock?.block_type === TABLE_CELL_BLOCK_TYPE) {
              // Get text content from cell's children (Text blocks)
              const childIds: string[] = cellBlock.children ?? [];
              const textParts: string[] = [];

              for (const childId of childIds) {
                tableRelatedIds.add(childId);
                const textBlock = blockMap.get(childId);
                if (textBlock?.block_type === 2 && textBlock.text?.elements) {
                  const text = textBlock.text.elements
                    .filter((e: any) => e.text_run)
                    .map((e: any) => e.text_run.content)
                    .join("");
                  textParts.push(text);
                }
              }

              cells[row][col] = textParts.join("\n");
            }

            cellIndex++;
          }
        }

        tables.push({ rowSize, colSize, cells });
      }
    }
  }

  // Collect non-table blocks
  for (const block of blocks) {
    if (!tableRelatedIds.has(block.block_id)) {
      otherBlocks.push(block);
    }
  }

  return { tables, otherBlocks };
}

/** Clean blocks for insertion (remove read-only fields and unsupported nested structures) */
function cleanBlocksForInsert(blocks: any[]): { cleaned: any[]; skipped: string[] } {
  const skipped: string[] = [];
  const cleaned = blocks.map((block) => {
    const { children, parent_id, block_id, ...rest } = block;

    // Remove children from non-table blocks (nested lists not supported in create API)
    // Table children are handled separately via table.cells
    if (block.block_type === TABLE_BLOCK_TYPE && block.table?.merge_info) {
      const { merge_info, ...tableRest } = block.table;
      return { ...rest, table: tableRest };
    }

    return rest;
  });
  return { cleaned, skipped };
}

// ============ Core Functions ============

/** Convert markdown to Feishu blocks using the Convert API */
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

/** Insert blocks as children of a parent block (with batching for >50 blocks) */
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

  // Feishu API limits to 50 blocks per request
  const BATCH_SIZE = 50;
  const allChildren: any[] = [];

  // Get current children count to determine insert index
  let insertIndex = 0;
  const existing = await client.docx.documentBlockChildren.get({
    path: { document_id: docToken, block_id: blockId },
  });
  if (existing.code === 0) {
    insertIndex = existing.data?.items?.length ?? 0;
  }

  for (let i = 0; i < cleaned.length; i += BATCH_SIZE) {
    const batch = cleaned.slice(i, i + BATCH_SIZE);
    const res = await client.docx.documentBlockChildren.create({
      path: { document_id: docToken, block_id: blockId },
      data: { children: batch, index: insertIndex },
    });
    if (res.code !== 0) throw new Error(res.msg);
    const inserted = res.data?.children ?? [];
    allChildren.push(...inserted);
    insertIndex += inserted.length;
  }

  return { children: allChildren, skipped };
}

/** Delete all child blocks from a parent */
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

/** Upload image to Feishu drive for docx */
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

/** Download image from URL */
async function downloadImage(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/** Create an empty table and return its block ID */
async function createEmptyTable(
  client: Lark.Client,
  docToken: string,
  parentBlockId: string,
  rowSize: number,
  colSize: number,
): Promise<string | null> {
  const tableBlock = {
    block_type: TABLE_BLOCK_TYPE,
    table: {
      property: {
        row_size: rowSize,
        column_size: colSize,
        header_row: true,
      },
      cells: [], // Empty cells, will be filled later
    },
  };

  const res = await client.docx.documentBlockChildren.create({
    path: { document_id: docToken, block_id: parentBlockId },
    data: { children: [tableBlock] },
  });

  if (res.code !== 0) {
    console.error(`Failed to create table: ${res.msg}`);
    return null;
  }

  const created = res.data?.children ?? [];
  return created[0]?.block_id ?? null;
}

/** Get children blocks of a parent block */
async function getBlockChildren(
  client: Lark.Client,
  docToken: string,
  blockId: string,
): Promise<any[]> {
  const res = await client.docx.documentBlockChildren.get({
    path: { document_id: docToken, block_id: blockId },
  });
  if (res.code !== 0) {
    throw new Error(`Failed to get block children: ${res.msg}`);
  }
  return res.data?.items ?? [];
}

/** Update a text block's content */
async function updateTextBlock(
  client: Lark.Client,
  docToken: string,
  blockId: string,
  content: string,
): Promise<void> {
  const res = await client.docx.documentBlock.patch({
    path: { document_id: docToken, block_id: blockId },
    data: {
      update_text_elements: {
        elements: [{ text_run: { content } }],
      },
    },
  });
  if (res.code !== 0) {
    console.error(`Failed to update text block ${blockId}: ${res.msg}`);
  }
}

/** Fill table cells with content */
async function fillTableContent(
  client: Lark.Client,
  docToken: string,
  tableBlockId: string,
  cells: string[][],
): Promise<void> {
  // Get table's cell blocks (they are direct children of the table)
  const cellBlocks = await getBlockChildren(client, docToken, tableBlockId);

  // Cells are in row-major order
  const colSize = cells[0]?.length ?? 0;
  let cellIndex = 0;

  for (let row = 0; row < cells.length; row++) {
    for (let col = 0; col < colSize; col++) {
      if (cellIndex >= cellBlocks.length) break;

      const cellBlock = cellBlocks[cellIndex];
      const cellBlockId = cellBlock?.block_id;
      const cellText = cells[row]?.[col] ?? "";

      if (cellBlockId && cellText) {
        // Each cell block contains text blocks as children
        const cellChildren = await getBlockChildren(client, docToken, cellBlockId);
        if (cellChildren.length > 0) {
          // Update the first text block in the cell
          const textBlockId = cellChildren[0]?.block_id;
          if (textBlockId) {
            await updateTextBlock(client, docToken, textBlockId, cellText);
          }
        }
      }

      cellIndex++;
    }
  }
}

/** Create and fill a table */
async function createAndFillTable(
  client: Lark.Client,
  docToken: string,
  parentBlockId: string,
  tableData: TableData,
): Promise<boolean> {
  // 1. Create empty table
  const tableBlockId = await createEmptyTable(
    client,
    docToken,
    parentBlockId,
    tableData.rowSize,
    tableData.colSize,
  );

  if (!tableBlockId) {
    return false;
  }

  // 2. Fill table content
  await fillTableContent(client, docToken, tableBlockId, tableData.cells);

  return true;
}

/** Process images in markdown: download from URL, upload to Feishu, update blocks */
async function processImages(
  client: Lark.Client,
  docToken: string,
  markdown: string,
  insertedBlocks: any[],
): Promise<number> {
  const imageUrls = extractImageUrls(markdown);
  if (imageUrls.length === 0) return 0;

  // Find Image blocks (block_type 27)
  const imageBlocks = insertedBlocks.filter((b) => b.block_type === 27);

  let processed = 0;
  for (let i = 0; i < Math.min(imageUrls.length, imageBlocks.length); i++) {
    const url = imageUrls[i];
    const blockId = imageBlocks[i].block_id;

    try {
      // Download image from URL
      const buffer = await downloadImage(url);

      // Generate filename from URL
      const urlPath = new URL(url).pathname;
      const fileName = urlPath.split("/").pop() || `image_${i}.png`;

      // Upload to Feishu
      const fileToken = await uploadImageToDocx(client, blockId, buffer, fileName);

      // Update the image block
      await client.docx.documentBlock.patch({
        path: { document_id: docToken, block_id: blockId },
        data: {
          replace_image: { token: fileToken },
        },
      });

      processed++;
    } catch (err) {
      // Log but continue processing other images
      console.error(`Failed to process image ${url}:`, err);
    }
  }

  return processed;
}

// ============ Wiki Functions ============

type WikiNodeInfo = {
  node_token: string;
  obj_token: string;
  obj_type: string;
  space_id: string;
  title?: string;
  parent_node_token?: string;
  node_type?: string;
  origin_space_id?: string;
};

/** Get wiki node info by token (from /wiki/XXX URL) */
async function getWikiNode(client: Lark.Client, wikiToken: string): Promise<WikiNodeInfo> {
  const res = await client.wiki.space.getNode({
    params: { token: wikiToken },
  });
  if (res.code !== 0) throw new Error(res.msg);
  const node = res.data?.node;
  if (!node) throw new Error("Wiki node not found");
  return {
    node_token: node.node_token ?? wikiToken,
    obj_token: node.obj_token ?? "",
    obj_type: node.obj_type ?? "",
    space_id: node.space_id ?? "",
    title: node.title,
    parent_node_token: node.parent_node_token,
    node_type: node.node_type,
    origin_space_id: node.origin_space_id,
  };
}

/** Read wiki page content (resolves to underlying docx) */
async function readWiki(client: Lark.Client, wikiToken: string) {
  // 1. Get wiki node info to find the underlying document
  const node = await getWikiNode(client, wikiToken);

  if (node.obj_type !== "docx") {
    return {
      node,
      error: `Wiki node is of type '${node.obj_type}', only 'docx' is supported for reading content. Use the obj_token with the appropriate API.`,
    };
  }

  // 2. Read the underlying docx content
  const docContent = await readDoc(client, node.obj_token);

  return {
    wiki_token: wikiToken,
    title: node.title,
    obj_type: node.obj_type,
    obj_token: node.obj_token,
    space_id: node.space_id,
    ...docContent,
  };
}

/** List wiki spaces */
async function listWikiSpaces(client: Lark.Client) {
  const res = await client.wiki.space.list({});
  if (res.code !== 0) throw new Error(res.msg);

  return {
    spaces:
      res.data?.items?.map((s) => ({
        space_id: s.space_id,
        name: s.name,
        description: s.description,
        type: s.space_type === "team" ? "team" : "personal",
        visibility: s.visibility,
      })) ?? [],
  };
}

/** List wiki nodes under a parent */
async function listWikiNodes(client: Lark.Client, spaceId: string, parentNodeToken?: string) {
  const res = await client.wiki.spaceNode.list({
    path: { space_id: spaceId },
    params: { parent_node_token: parentNodeToken },
  });
  if (res.code !== 0) throw new Error(res.msg);

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

// ============ Actions ============

// Block types that are NOT included in rawContent (plain text) output
const STRUCTURED_BLOCK_TYPES = new Set([14, 18, 21, 23, 27, 30, 31, 32]);
// 14=Code, 18=Bitable, 21=Diagram, 23=File, 27=Image, 30=Sheet, 31=Table, 32=TableCell

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

    // Track structured types that need list_blocks to read
    if (STRUCTURED_BLOCK_TYPES.has(type) && !structuredTypes.includes(name)) {
      structuredTypes.push(name);
    }
  }

  // Build hint if there are structured blocks
  let hint: string | undefined;
  if (structuredTypes.length > 0) {
    hint = `This document contains ${structuredTypes.join(", ")} which are NOT included in the plain text above. Use feishu_doc_list_blocks to get full content.`;
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

/** Set document permission to allow tenant members to edit */
async function setDocPermissionTenantEditable(client: Lark.Client, docToken: string) {
  const res = await client.drive.permissionPublic.patch({
    path: { token: docToken },
    params: { type: "docx" },
    data: {
      link_share_entity: "tenant_editable",
      share_entity: "same_tenant",
    },
  });
  if (res.code !== 0) throw new Error(res.msg);
  return res.data;
}

export type DocPermission = "private" | "tenant_editable";

async function createDoc(
  client: Lark.Client,
  title: string,
  folderToken?: string,
  permission?: DocPermission,
) {
  const res = await client.docx.document.create({
    data: { title, folder_token: folderToken },
  });
  if (res.code !== 0) throw new Error(res.msg);
  const doc = res.data?.document;
  const docId = doc?.document_id;

  // Set permission if requested
  if (permission === "tenant_editable" && docId) {
    await setDocPermissionTenantEditable(client, docId);
  }

  return {
    document_id: docId,
    title: doc?.title,
    url: `https://feishu.cn/docx/${docId}`,
    permission: permission ?? "private",
  };
}

async function writeDoc(client: Lark.Client, docToken: string, markdown: string) {
  // 1. Clear existing content
  const deleted = await clearDocumentContent(client, docToken);

  // 2. Convert markdown to blocks
  const { blocks } = await convertMarkdown(client, markdown);
  if (blocks.length === 0) {
    return { success: true, blocks_deleted: deleted, blocks_added: 0, images_processed: 0, tables_created: 0 };
  }

  // 3. Separate tables from other blocks
  const { tables, otherBlocks } = extractTableFromBlocks(blocks);

  // 4. Insert non-table blocks
  const { children: inserted, skipped } = await insertBlocks(client, docToken, otherBlocks);

  // 5. Create and fill tables
  let tablesCreated = 0;
  for (const tableData of tables) {
    const success = await createAndFillTable(client, docToken, docToken, tableData);
    if (success) tablesCreated++;
  }

  // 6. Process images
  const imagesProcessed = await processImages(client, docToken, markdown, inserted);

  return {
    success: true,
    blocks_deleted: deleted,
    blocks_added: inserted.length,
    tables_created: tablesCreated,
    images_processed: imagesProcessed,
    ...(skipped.length > 0 && {
      warning: `Skipped unsupported block types: ${skipped.join(", ")}.`,
    }),
  };
}

async function appendDoc(client: Lark.Client, docToken: string, markdown: string) {
  // 1. Convert markdown to blocks
  const { blocks } = await convertMarkdown(client, markdown);
  if (blocks.length === 0) {
    throw new Error("Content is empty");
  }

  // 2. Separate tables from other blocks
  const { tables, otherBlocks } = extractTableFromBlocks(blocks);

  // 3. Insert non-table blocks
  const { children: inserted, skipped } = await insertBlocks(client, docToken, otherBlocks);

  // 4. Create and fill tables
  let tablesCreated = 0;
  for (const tableData of tables) {
    const success = await createAndFillTable(client, docToken, docToken, tableData);
    if (success) tablesCreated++;
  }

  // 5. Process images
  const imagesProcessed = await processImages(client, docToken, markdown, inserted);

  return {
    success: true,
    blocks_added: inserted.length,
    tables_created: tablesCreated,
    images_processed: imagesProcessed,
    block_ids: inserted.map((b: any) => b.block_id),
    ...(skipped.length > 0 && {
      warning: `Skipped unsupported block types: ${skipped.join(", ")}.`,
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

  // Return full block data for agent to parse
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

async function listFolder(client: Lark.Client, folderToken: string) {
  const res = await client.drive.file.list({
    params: { folder_token: folderToken },
  });
  if (res.code !== 0) throw new Error(res.msg);

  return {
    files: res.data?.files?.map((f) => ({
      token: f.token,
      name: f.name,
      type: f.type,
      url: f.url,
    })),
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

// ============ Schemas ============

const DocTokenSchema = Type.Object({
  doc_token: Type.String({ description: "Document token (extract from URL /docx/XXX)" }),
});

const CreateDocSchema = Type.Object({
  title: Type.String({ description: "Document title" }),
  folder_token: Type.Optional(Type.String({ description: "Target folder token (optional)" })),
  permission: Type.Optional(
    Type.Union([Type.Literal("private"), Type.Literal("tenant_editable")], {
      description:
        "Document permission: 'private' (default) or 'tenant_editable' (organization members can edit via link)",
    }),
  ),
});

const WriteDocSchema = Type.Object({
  doc_token: Type.String({ description: "Document token" }),
  content: Type.String({
    description: "Markdown content to write (replaces entire document content)",
  }),
});

const AppendDocSchema = Type.Object({
  doc_token: Type.String({ description: "Document token" }),
  content: Type.String({ description: "Markdown content to append to end of document" }),
});

const UpdateBlockSchema = Type.Object({
  doc_token: Type.String({ description: "Document token" }),
  block_id: Type.String({ description: "Block ID (get from list_blocks)" }),
  content: Type.String({ description: "New text content" }),
});

const DeleteBlockSchema = Type.Object({
  doc_token: Type.String({ description: "Document token" }),
  block_id: Type.String({ description: "Block ID" }),
});

const GetBlockSchema = Type.Object({
  doc_token: Type.String({ description: "Document token" }),
  block_id: Type.String({ description: "Block ID (from list_blocks)" }),
});

const FolderTokenSchema = Type.Object({
  folder_token: Type.String({ description: "Folder token" }),
});

const SetPermissionSchema = Type.Object({
  doc_token: Type.String({ description: "Document token" }),
  permission: Type.Union([Type.Literal("private"), Type.Literal("tenant_editable")], {
    description: "'private' or 'tenant_editable' (organization members can edit via link)",
  }),
});

// Wiki Schemas
const WikiTokenSchema = Type.Object({
  wiki_token: Type.String({ description: "Wiki token (extract from URL /wiki/XXX)" }),
});

const WikiSpaceIdSchema = Type.Object({
  space_id: Type.String({ description: "Wiki space ID" }),
  parent_node_token: Type.Optional(
    Type.String({ description: "Parent node token (optional, for listing children)" }),
  ),
});

// ============ Tool Registration ============

export function registerFeishuDocTools(api: OpenClawPluginApi) {
  const feishuCfg = api.config?.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg?.appId || !feishuCfg?.appSecret) {
    api.logger.debug?.("feishu_doc: Feishu credentials not configured, skipping doc tools");
    return;
  }

  const getClient = () => createFeishuClient(feishuCfg);

  // Tool 1: feishu_doc_read
  api.registerTool(
    {
      name: "feishu_doc_read",
      label: "Feishu Doc Read",
      description: "Read plain text content and metadata from a Feishu document",
      parameters: DocTokenSchema,
      async execute(_toolCallId, params) {
        const { doc_token } = params as { doc_token: string };
        try {
          const result = await readDoc(getClient(), doc_token);
          return json(result);
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    { name: "feishu_doc_read" },
  );

  // Tool 2: feishu_doc_create
  api.registerTool(
    {
      name: "feishu_doc_create",
      label: "Feishu Doc Create",
      description:
        "Create a new empty Feishu document. Use permission='tenant_editable' to allow organization members to edit via link.",
      parameters: CreateDocSchema,
      async execute(_toolCallId, params) {
        const { title, folder_token, permission } = params as {
          title: string;
          folder_token?: string;
          permission?: DocPermission;
        };
        try {
          const result = await createDoc(getClient(), title, folder_token, permission);
          return json(result);
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    { name: "feishu_doc_create" },
  );

  // Tool 3: feishu_doc_write (NEW)
  api.registerTool(
    {
      name: "feishu_doc_write",
      label: "Feishu Doc Write",
      description:
        "Write markdown content to a Feishu document (replaces all content). Supports headings, lists, code blocks, quotes, links, images, tables, and text styling.",
      parameters: WriteDocSchema,
      async execute(_toolCallId, params) {
        const { doc_token, content } = params as { doc_token: string; content: string };
        try {
          const result = await writeDoc(getClient(), doc_token, content);
          return json(result);
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    { name: "feishu_doc_write" },
  );

  // Tool 4: feishu_doc_append
  api.registerTool(
    {
      name: "feishu_doc_append",
      label: "Feishu Doc Append",
      description:
        "Append markdown content to the end of a Feishu document. Supports same markdown syntax as write.",
      parameters: AppendDocSchema,
      async execute(_toolCallId, params) {
        const { doc_token, content } = params as { doc_token: string; content: string };
        try {
          const result = await appendDoc(getClient(), doc_token, content);
          return json(result);
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    { name: "feishu_doc_append" },
  );

  // Tool 5: feishu_doc_update_block
  api.registerTool(
    {
      name: "feishu_doc_update_block",
      label: "Feishu Doc Update Block",
      description: "Update the text content of a specific block in a Feishu document",
      parameters: UpdateBlockSchema,
      async execute(_toolCallId, params) {
        const { doc_token, block_id, content } = params as {
          doc_token: string;
          block_id: string;
          content: string;
        };
        try {
          const result = await updateBlock(getClient(), doc_token, block_id, content);
          return json(result);
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    { name: "feishu_doc_update_block" },
  );

  // Tool 6: feishu_doc_delete_block
  api.registerTool(
    {
      name: "feishu_doc_delete_block",
      label: "Feishu Doc Delete Block",
      description: "Delete a specific block from a Feishu document",
      parameters: DeleteBlockSchema,
      async execute(_toolCallId, params) {
        const { doc_token, block_id } = params as { doc_token: string; block_id: string };
        try {
          const result = await deleteBlock(getClient(), doc_token, block_id);
          return json(result);
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    { name: "feishu_doc_delete_block" },
  );

  // Tool 7: feishu_doc_list_blocks
  api.registerTool(
    {
      name: "feishu_doc_list_blocks",
      label: "Feishu Doc List Blocks",
      description:
        "List all blocks in a Feishu document with full content. Use this to read structured content like tables. Returns block_id for use with update/delete/get_block.",
      parameters: DocTokenSchema,
      async execute(_toolCallId, params) {
        const { doc_token } = params as { doc_token: string };
        try {
          const result = await listBlocks(getClient(), doc_token);
          return json(result);
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    { name: "feishu_doc_list_blocks" },
  );

  // Tool 8: feishu_doc_get_block
  api.registerTool(
    {
      name: "feishu_doc_get_block",
      label: "Feishu Doc Get Block",
      description: "Get detailed content of a specific block by ID (from list_blocks)",
      parameters: GetBlockSchema,
      async execute(_toolCallId, params) {
        const { doc_token, block_id } = params as { doc_token: string; block_id: string };
        try {
          const result = await getBlock(getClient(), doc_token, block_id);
          return json(result);
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    { name: "feishu_doc_get_block" },
  );

  // Tool 9: feishu_folder_list
  api.registerTool(
    {
      name: "feishu_folder_list",
      label: "Feishu Folder List",
      description: "List documents and subfolders in a Feishu folder",
      parameters: FolderTokenSchema,
      async execute(_toolCallId, params) {
        const { folder_token } = params as { folder_token: string };
        try {
          const result = await listFolder(getClient(), folder_token);
          return json(result);
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    { name: "feishu_folder_list" },
  );

  // Tool 10: feishu_doc_set_permission
  api.registerTool(
    {
      name: "feishu_doc_set_permission",
      label: "Feishu Doc Set Permission",
      description:
        "Set document sharing permission. Use 'tenant_editable' to allow organization members to edit via link.",
      parameters: SetPermissionSchema,
      async execute(_toolCallId, params) {
        const { doc_token, permission } = params as { doc_token: string; permission: DocPermission };
        try {
          if (permission === "tenant_editable") {
            await setDocPermissionTenantEditable(getClient(), doc_token);
            return json({ success: true, permission: "tenant_editable" });
          } else {
            // Reset to private (only owner can access)
            const client = getClient();
            const res = await client.drive.permissionPublic.patch({
              path: { token: doc_token },
              params: { type: "docx" },
              data: {
                link_share_entity: "closed",
                share_entity: "only_full_access",
              },
            });
            if (res.code !== 0) throw new Error(res.msg);
            return json({ success: true, permission: "private" });
          }
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    { name: "feishu_doc_set_permission" },
  );

  // Tool 11: feishu_wiki_read
  api.registerTool(
    {
      name: "feishu_wiki_read",
      label: "Feishu Wiki Read",
      description:
        "Read content from a Feishu wiki page. Extract wiki_token from URL /wiki/XXX. Returns wiki metadata and document content if the underlying type is docx.",
      parameters: WikiTokenSchema,
      async execute(_toolCallId, params) {
        const { wiki_token } = params as { wiki_token: string };
        try {
          const result = await readWiki(getClient(), wiki_token);
          return json(result);
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    { name: "feishu_wiki_read" },
  );

  // Tool 12: feishu_wiki_spaces
  api.registerTool(
    {
      name: "feishu_wiki_spaces",
      label: "Feishu Wiki Spaces",
      description: "List available wiki spaces (knowledge bases) the app has access to.",
      parameters: Type.Object({}),
      async execute() {
        try {
          const result = await listWikiSpaces(getClient());
          return json(result);
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    { name: "feishu_wiki_spaces" },
  );

  // Tool 13: feishu_wiki_nodes
  api.registerTool(
    {
      name: "feishu_wiki_nodes",
      label: "Feishu Wiki Nodes",
      description:
        "List wiki nodes (pages) in a space. Use parent_node_token to list children of a specific node.",
      parameters: WikiSpaceIdSchema,
      async execute(_toolCallId, params) {
        const { space_id, parent_node_token } = params as {
          space_id: string;
          parent_node_token?: string;
        };
        try {
          const result = await listWikiNodes(getClient(), space_id, parent_node_token);
          return json(result);
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    { name: "feishu_wiki_nodes" },
  );

  // Tool 14: feishu_app_scopes
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

  api.logger.info?.(`feishu_doc: Registered 14 document/wiki tools`);
}
