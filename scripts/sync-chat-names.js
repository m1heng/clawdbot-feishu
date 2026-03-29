#!/usr/bin/env node

/**
 * Sync Feishu chat names to bindings.
 * Usage: node sync-feishu-names-standalone.js [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const configPath = path.join(process.env.HOME || '/root', '.openclaw', 'openclaw.json');

// Load config
if (!fs.existsSync(configPath)) {
  console.error(`❌ Config file not found: ${configPath}`);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Get Feishu config
const feishuConfig = config.channels?.feishu;
if (!feishuConfig || !feishuConfig.appId || !feishuConfig.appSecret) {
  console.error('❌ Feishu not configured');
  process.exit(1);
}

// Get bindings
const bindings = config.bindings || [];
const feishuGroupBindings = bindings.filter(
  b => b.match?.channel === 'feishu' && b.match?.peer?.kind === 'group' && b.match?.peer?.id
);

if (feishuGroupBindings.length === 0) {
  console.log('No Feishu group bindings found');
  process.exit(0);
}

console.log(`Found ${feishuGroupBindings.length} Feishu group bindings`);
console.log(`Dry run: ${dryRun ? 'yes' : 'no'}\n`);

// Fetch chat names from Feishu API
import('@larksuiteoapi/node-sdk').then(async (lark) => {
  const client = new lark.Client({
    appId: feishuConfig.appId,
    appSecret: feishuConfig.appSecret,
  });

  try {
    const response = await client.im.chat.list({
      params: {
        page_size: 100,
      },
    });

    if (response.code !== 0 || !response.data?.items) {
      console.error(`❌ Feishu API error: ${response.msg || 'Unknown error'}`);
      process.exit(1);
    }

    // Build chat_id -> name mapping
    const chatNames = {};
    for (const chat of response.data.items) {
      if (chat.chat_id && chat.name) {
        chatNames[chat.chat_id] = chat.name;
      }
    }

    console.log(`Fetched ${Object.keys(chatNames).length} chat names from Feishu API\n`);

    // Update bindings
    let updated = 0;
    let skipped = 0;

    for (const binding of feishuGroupBindings) {
      const peer = binding.match.peer;
      const chatId = peer.id;
      const chatName = chatNames[chatId];

      if (!chatName) {
        console.log(`⚠️  Chat ${chatId} not found in API response`);
        skipped++;
        continue;
      }

      if (peer.name === chatName) {
        console.log(`✓ ${chatId} already has correct name: ${chatName}`);
        skipped++;
        continue;
      }

      if (!dryRun) {
        peer.name = chatName;
      }

      console.log(`✓ ${binding.agentId} / ${chatId} → ${chatName}`);
      updated++;
    }

    // Save config
    if (!dryRun && updated > 0) {
      const backupPath = configPath + '.bak';
      fs.copyFileSync(configPath, backupPath);
      console.log(`\nBacked up config to ${backupPath}`);

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log(`Saved config to ${configPath}`);
    }

    console.log(`\n✅ Sync complete: ${updated} updated, ${skipped} skipped`);
    
    if (dryRun && updated > 0) {
      console.log('\n💡 Run without --dry-run to apply changes');
    }

    process.exit(0);
  } catch (err) {
    console.error(`❌ Error: ${err.message || err}`);
    process.exit(1);
  }
}).catch(err => {
  console.error(`❌ Failed to load Feishu SDK: ${err.message || err}`);
  process.exit(1);
});
