#!/usr/bin/env npx tsx
/**
 * Integration test: verify ordered-list neutralization against Feishu's convert API.
 *
 * Sends markdown through preprocessMarkdown() → document.convert() and asserts
 * that NO block_type:13 (Ordered) blocks are returned.
 *
 * Usage:
 *   export FEISHU_APP_ID=cli_xxx
 *   export FEISHU_APP_SECRET=xxx
 *   npx tsx scripts/test-ordered-lists.ts
 *
 * With real document creation (creates a doc you can inspect in Feishu):
 *   npx tsx scripts/test-ordered-lists.ts --create
 */

import * as Lark from "@larksuiteoapi/node-sdk";
import { neutralizeOrderedMarkers } from "../src/docx.js";

// ── env ──────────────────────────────────────────────────────────────

const appId = process.env.FEISHU_APP_ID;
const appSecret = process.env.FEISHU_APP_SECRET;
const shouldCreate = process.argv.includes("--create");

if (!appId || !appSecret) {
  console.error("Error: Set FEISHU_APP_ID and FEISHU_APP_SECRET environment variables");
  process.exit(1);
}

const client = new Lark.Client({
  appId,
  appSecret,
  appType: Lark.AppType.SelfBuild,
  domain: Lark.Domain.Feishu,
});

// ── block-type reference ─────────────────────────────────────────────

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
  22: "Divider",
  27: "Image",
};

// ── test content ─────────────────────────────────────────────────────

const TEST_MARKDOWN = `# 测试

【01】第一条
【02】第二条
【03】第三条
1. Alpha
2. Beta
- 无序一
- 无序二
`;

// ── helpers ──────────────────────────────────────────────────────────

function blockTypeName(type: number): string {
  return BLOCK_TYPE_NAMES[type] || `type_${type}`;
}

function extractText(block: any): string {
  // Try to pull text from common element shapes
  const elements =
    block.text?.elements ??
    block.heading1?.elements ??
    block.heading2?.elements ??
    block.heading3?.elements ??
    block.bullet?.elements ??
    block.ordered?.elements ??
    [];
  return elements.map((e: any) => e.text_run?.content ?? "").join("").trim();
}

// ── main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("\n=== Ordered-List Integration Test ===\n");

  // 1. Preprocess
  const preprocessed = neutralizeOrderedMarkers(TEST_MARKDOWN);
  console.log("1. Preprocessed markdown:");
  console.log("---");
  console.log(preprocessed);
  console.log("---\n");

  // 2. Convert via Feishu API
  console.log("2. Calling document.convert() ...");
  const res = await client.docx.document.convert({
    data: { content_type: "markdown", content: preprocessed },
  });
  if (res.code !== 0) {
    console.error(`   API error (${res.code}): ${res.msg}`);
    process.exit(1);
  }

  const blocks: any[] = res.data?.blocks ?? [];
  console.log(`   Received ${blocks.length} blocks\n`);

  // 3. Print & check
  let hasOrdered = false;
  console.log("3. Block details:");
  for (const block of blocks) {
    const type = block.block_type ?? 0;
    const name = blockTypeName(type);
    const text = extractText(block);
    const tag = type === 13 ? " ← FAIL" : "";
    console.log(`   [${name.padEnd(8)}] ${text || "(no text)"}${tag}`);
    if (type === 13) hasOrdered = true;
  }

  // 4. Verdict
  console.log("");
  if (hasOrdered) {
    console.error("FAIL: block_type 13 (Ordered) was found — neutralization did not work.");
    process.exit(1);
  }
  console.log("PASS: No block_type 13 found. All ordered markers were neutralized.\n");

  // 5. Optional: create a real document
  if (shouldCreate) {
    console.log("=== Creating real document (--create) ===\n");

    const createRes = await client.docx.document.create({
      data: { title: `ordered-list-test-${Date.now()}` },
    });
    if (createRes.code !== 0) {
      console.error(`Create error (${createRes.code}): ${createRes.msg}`);
      process.exit(1);
    }

    const docToken = createRes.data?.document?.document_id!;
    console.log(`   Created doc: ${docToken}`);
    console.log(`   URL: https://feishu.cn/docx/${docToken}\n`);

    // Insert blocks
    const { cleaned } = cleanForInsert(blocks);
    if (cleaned.length > 0) {
      const insertRes = await client.docx.documentBlockChildren.create({
        path: { document_id: docToken, block_id: docToken },
        data: { children: cleaned },
      });
      if (insertRes.code !== 0) {
        console.error(`Insert error (${insertRes.code}): ${insertRes.msg}`);
        process.exit(1);
      }
      console.log(`   Inserted ${insertRes.data?.children?.length ?? 0} blocks`);
    }

    // Re-read blocks and verify
    console.log("\n   Verifying via list_blocks ...");
    const listRes = await client.docx.documentBlock.list({
      path: { document_id: docToken },
    });
    if (listRes.code !== 0) {
      console.error(`List error (${listRes.code}): ${listRes.msg}`);
      process.exit(1);
    }

    const liveBlocks = listRes.data?.items ?? [];
    let liveOrdered = false;
    for (const block of liveBlocks) {
      const type = block.block_type ?? 0;
      const name = blockTypeName(type);
      const tag = type === 13 ? " ← FAIL" : "";
      console.log(`   [${name.padEnd(8)}] block_id=${block.block_id}${tag}`);
      if (type === 13) liveOrdered = true;
    }

    console.log("");
    if (liveOrdered) {
      console.error("FAIL: Live document contains block_type 13 (Ordered).");
      process.exit(1);
    }
    console.log("PASS: Live document has no Ordered blocks.\n");
  }

  console.log("=== Done ===\n");
}

/** Strip unsupported block types for insertion */
function cleanForInsert(blocks: any[]): { cleaned: any[]; skipped: string[] } {
  const UNSUPPORTED = new Set([31, 32]);
  const skipped: string[] = [];
  const cleaned = blocks.filter((b) => {
    if (UNSUPPORTED.has(b.block_type)) {
      skipped.push(blockTypeName(b.block_type));
      return false;
    }
    return true;
  });
  return { cleaned, skipped };
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
