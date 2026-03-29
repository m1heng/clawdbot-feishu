import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import { createFeishuClient } from "./client.js";
import { resolveFeishuAccount } from "./accounts.js";
import * as fs from "fs";
import * as path from "path";

export type SyncNamesOptions = {
  cfg: ClawdbotConfig;
  accountId?: string;
  configPath?: string;
  dryRun?: boolean;
  log?: (...args: any[]) => void;
};

export type SyncNamesResult = {
  success: boolean;
  updated: number;
  skipped: number;
  errors: string[];
  chatNames: Record<string, string>;
};

/**
 * Sync chat names for all Feishu group bindings.
 * Fetches chat names from Feishu API and updates the config file.
 */
export async function syncFeishuChatNames(options: SyncNamesOptions): Promise<SyncNamesResult> {
  const { cfg, accountId, configPath, dryRun = false, log = console.log } = options;

  const result: SyncNamesResult = {
    success: false,
    updated: 0,
    skipped: 0,
    errors: [],
    chatNames: {},
  };

  try {
    // Resolve account
    const account = resolveFeishuAccount({ cfg, accountId });
    if (!account.configured) {
      result.errors.push("Feishu account not configured");
      return result;
    }

    // Get all bindings
    const bindings = cfg.bindings || [];
    const feishuGroupBindings = bindings.filter(
      (b: any) =>
        b.match?.channel === "feishu" &&
        b.match?.peer?.kind === "group" &&
        b.match?.peer?.id
    );

    if (feishuGroupBindings.length === 0) {
      log("No Feishu group bindings found");
      result.success = true;
      return result;
    }

    log(`Found ${feishuGroupBindings.length} Feishu group bindings`);

    // Fetch all chats from Feishu API
    const client = createFeishuClient(account);
    const response = await client.im.chat.list({
      params: {
        page_size: 100,
      },
    });

    if (response.code !== 0 || !response.data?.items) {
      result.errors.push(`Feishu API error: ${response.msg || "Unknown error"}`);
      return result;
    }

    // Build chat_id -> name mapping
    const chatNames: Record<string, string> = {};
    for (const chat of response.data.items) {
      if (chat.chat_id && chat.name) {
        chatNames[chat.chat_id] = chat.name;
      }
    }

    log(`Fetched ${Object.keys(chatNames).length} chat names from Feishu API`);

    // Update bindings
    for (const binding of feishuGroupBindings) {
      const peer = binding.match.peer;
      const chatId = peer.id;
      const chatName = chatNames[chatId];

      if (!chatName) {
        log(`⚠️  Chat ${chatId} not found in API response`);
        result.skipped++;
        continue;
      }

      if (peer.name === chatName) {
        log(`✓ ${chatId} already has correct name: ${chatName}`);
        result.skipped++;
        continue;
      }

      if (!dryRun) {
        peer.name = chatName;
      }

      log(`✓ ${chatId} → ${chatName}`);
      result.updated++;
      result.chatNames[chatId] = chatName;
    }

    // Save config file if not dry run
    if (!dryRun && result.updated > 0) {
      if (!configPath) {
        result.errors.push("Config path not provided, cannot save");
        return result;
      }

      const configDir = path.dirname(configPath);
      const backupPath = path.join(configDir, "openclaw.json.bak");

      // Backup current config
      if (fs.existsSync(configPath)) {
        fs.copyFileSync(configPath, backupPath);
        log(`Backed up config to ${backupPath}`);
      }

      // Save updated config
      fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
      log(`Saved config to ${configPath}`);
    }

    result.success = true;
    log(`\n✅ Sync complete: ${result.updated} updated, ${result.skipped} skipped`);

    return result;
  } catch (err: any) {
    result.errors.push(err.message || String(err));
    log(`❌ Error: ${err.message || err}`);
    return result;
  }
}
