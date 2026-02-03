#!/usr/bin/env npx tsx
/**
 * Manual test script for Bitable tools
 *
 * Usage:
 *   export FEISHU_APP_ID=cli_xxx
 *   export FEISHU_APP_SECRET=xxx
 *   npx tsx scripts/test-bitable.ts <bitable_url>
 *
 * Example:
 *   npx tsx scripts/test-bitable.ts "https://xxx.feishu.cn/wiki/XXX?table=tblYYY"
 *   npx tsx scripts/test-bitable.ts "https://xxx.feishu.cn/base/XXX?table=tblYYY"
 */

import * as Lark from "@larksuiteoapi/node-sdk";

const appId = process.env.FEISHU_APP_ID;
const appSecret = process.env.FEISHU_APP_SECRET;
const inputUrl = process.argv[2];

if (!appId || !appSecret) {
  console.error("Error: Set FEISHU_APP_ID and FEISHU_APP_SECRET environment variables");
  process.exit(1);
}

if (!inputUrl) {
  console.error("Usage: npx tsx scripts/test-bitable.ts <bitable_url>");
  console.error('Example: npx tsx scripts/test-bitable.ts "https://xxx.feishu.cn/wiki/XXX?table=tblYYY"');
  process.exit(1);
}

const client = new Lark.Client({
  appId,
  appSecret,
  appType: Lark.AppType.SelfBuild,
  domain: Lark.Domain.Feishu,
});

/** Parse bitable URL and extract tokens */
function parseBitableUrl(url: string): { token: string; tableId?: string; isWiki: boolean } | null {
  try {
    const u = new URL(url);
    const tableId = u.searchParams.get("table") ?? undefined;

    // Wiki format: /wiki/XXXXX?table=YYY
    const wikiMatch = u.pathname.match(/\/wiki\/([A-Za-z0-9]+)/);
    if (wikiMatch) {
      return { token: wikiMatch[1], tableId, isWiki: true };
    }

    // Base format: /base/XXXXX?table=YYY
    const baseMatch = u.pathname.match(/\/base\/([A-Za-z0-9]+)/);
    if (baseMatch) {
      return { token: baseMatch[1], tableId, isWiki: false };
    }

    return null;
  } catch {
    return null;
  }
}

async function main() {
  console.log(`\n=== Testing Bitable URL: ${inputUrl} ===\n`);

  // 0. Parse URL
  const parsed = parseBitableUrl(inputUrl);
  if (!parsed) {
    console.error("Error: Invalid URL format. Expected /base/XXX or /wiki/XXX URL");
    process.exit(1);
  }
  console.log(`0. Parsed URL: token=${parsed.token}, tableId=${parsed.tableId}, isWiki=${parsed.isWiki}`);

  // 1. Get app_token (convert wiki node_token if needed)
  let appToken: string;
  if (parsed.isWiki) {
    console.log("\n1. Getting app_token from wiki node...");
    const nodeRes = await client.wiki.space.getNode({
      params: { token: parsed.token },
    });
    if (nodeRes.code !== 0) {
      console.error("  Error:", nodeRes.msg);
      return;
    }
    const node = nodeRes.data?.node;
    if (!node || node.obj_type !== "bitable") {
      console.error("  Error: Node is not a bitable (type:", node?.obj_type, ")");
      return;
    }
    appToken = node.obj_token!;
    console.log(`  Converted wiki node_token to app_token: ${appToken}`);
  } else {
    appToken = parsed.token;
    console.log("\n1. Using app_token directly from URL:", appToken);
  }

  const tableId = parsed.tableId;
  if (!tableId) {
    // List tables if no table_id specified
    console.log("\n  No table_id in URL, listing available tables...");
    const tablesRes = await client.bitable.appTable.list({
      path: { app_token: appToken },
    });
    if (tablesRes.code !== 0) {
      console.error("  Error:", tablesRes.msg);
      return;
    }
    const tables = tablesRes.data?.items ?? [];
    console.log(`  Found ${tables.length} tables:`);
    for (const t of tables) {
      console.log(`    - ${t.name} (table_id: ${t.table_id})`);
    }
    console.log("\n  Please add ?table=<table_id> to the URL and run again.");
    return;
  }

  console.log(`\n=== Testing app_token=${appToken}, table_id=${tableId} ===\n`);

  // 2. List fields
  console.log("2. Listing fields...");
  const fieldsRes = await client.bitable.appTableField.list({
    path: { app_token: appToken, table_id: tableId },
  });
  if (fieldsRes.code !== 0) {
    console.error("  Error:", fieldsRes.msg);
    return;
  }
  const fields = fieldsRes.data?.items ?? [];
  console.log(`  Found ${fields.length} fields:`);
  for (const f of fields) {
    console.log(`    - ${f.field_name} (type=${f.type}, id=${f.field_id})`);
  }

  // 3. List records
  console.log("\n3. Listing records (first 5)...");
  const recordsRes = await client.bitable.appTableRecord.list({
    path: { app_token: appToken, table_id: tableId },
    params: { page_size: 5 },
  });
  if (recordsRes.code !== 0) {
    console.error("  Error:", recordsRes.msg);
    return;
  }
  const records = recordsRes.data?.items ?? [];
  console.log(`  Found ${recordsRes.data?.total} total records, showing ${records.length}:`);
  for (const r of records) {
    console.log(`    - ${r.record_id}:`, JSON.stringify(r.fields).slice(0, 100) + "...");
  }

  // 4. Create a test record (only if there's a text field)
  const textField = fields.find((f) => f.type === 1);
  if (textField) {
    console.log(`\n4. Creating test record with field "${textField.field_name}"...`);
    const createRes = await client.bitable.appTableRecord.create({
      path: { app_token: appToken, table_id: tableId },
      data: {
        fields: {
          [textField.field_name!]: `Test from script - ${new Date().toISOString()}`,
        },
      },
    });
    if (createRes.code !== 0) {
      console.error("  Error:", createRes.msg);
    } else {
      const newRecordId = createRes.data?.record?.record_id;
      console.log(`  Created record: ${newRecordId}`);

      // 5. Get the record
      console.log("\n5. Getting the created record...");
      const getRes = await client.bitable.appTableRecord.get({
        path: { app_token: appToken, table_id: tableId, record_id: newRecordId! },
      });
      if (getRes.code !== 0) {
        console.error("  Error:", getRes.msg);
      } else {
        console.log("  Record:", JSON.stringify(getRes.data?.record?.fields, null, 2));
      }

      // 6. Update the record
      console.log("\n6. Updating the record...");
      const updateRes = await client.bitable.appTableRecord.update({
        path: { app_token: appToken, table_id: tableId, record_id: newRecordId! },
        data: {
          fields: {
            [textField.field_name!]: `Updated - ${new Date().toISOString()}`,
          },
        },
      });
      if (updateRes.code !== 0) {
        console.error("  Error:", updateRes.msg);
      } else {
        console.log("  Updated successfully");
      }
    }
  } else {
    console.log("\n4-6. Skipping create/get/update (no text field found)");
  }

  console.log("\n=== Done ===\n");
}

main().catch(console.error);
