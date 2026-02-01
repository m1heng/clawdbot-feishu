import { execSync, exec, spawn } from "child_process";
import * as Lark from "@larksuiteoapi/node-sdk";
import type { ClawdbotConfig, RuntimeEnv, HistoryEntry } from "openclaw/plugin-sdk";
import type { FeishuConfig } from "./types.js";
import { createFeishuWSClient, createEventDispatcher } from "./client.js";
import { resolveFeishuCredentials } from "./accounts.js";
import { handleFeishuMessage, type FeishuMessageEvent, type FeishuBotAddedEvent } from "./bot.js";
import { probeFeishu } from "./probe.js";

export type MonitorFeishuOpts = {
  config?: ClawdbotConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  accountId?: string;
};

let currentWsClient: Lark.WSClient | null = null;
let botOpenId: string | undefined;

async function fetchBotOpenId(cfg: FeishuConfig): Promise<string | undefined> {
  try {
    const result = await probeFeishu(cfg);
    return result.ok ? result.botOpenId : undefined;
  } catch {
    return undefined;
  }
}

// Helper to execute script with payload via Stdin
function executeScript(command: string, payload: any, log: (msg: string) => void, error: (msg: string) => void) {
  log(`feishu: executing script '${command}'...`);
  const child = spawn(command, { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
  
  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (data) => { stdout += data.toString(); });
  child.stderr.on('data', (data) => { stderr += data.toString(); });

  child.on('close', (code) => {
    if (code !== 0) {
      error(`feishu: script '${command}' exited with code ${code}`);
      if (stderr) error(`feishu: stderr: ${stderr.trim()}`);
    } else {
      log(`feishu: script '${command}' finished successfully.`);
      if (stdout) log(`feishu: stdout: ${stdout.trim()}`);
    }
  });

  child.on('error', (err) => {
    error(`feishu: failed to start script '${command}': ${err.message}`);
  });

  // Write payload to stdin
  child.stdin.write(JSON.stringify(payload));
  child.stdin.end();
}

export async function monitorFeishuProvider(opts: MonitorFeishuOpts = {}): Promise<void> {
  const cfg = opts.config;
  if (!cfg) {
    throw new Error("Config is required for Feishu monitor");
  }

  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  const creds = resolveFeishuCredentials(feishuCfg);
  if (!creds) {
    throw new Error("Feishu credentials not configured (appId, appSecret required)");
  }

  const log = opts.runtime?.log ?? console.log;
  const error = opts.runtime?.error ?? console.error;

  if (feishuCfg) {
    botOpenId = await fetchBotOpenId(feishuCfg);
    log(`feishu: bot open_id resolved: ${botOpenId ?? "unknown"}`);
  }

  const connectionMode = feishuCfg?.connectionMode ?? "websocket";

  if (connectionMode === "websocket") {
    return monitorWebSocket({ cfg, feishuCfg: feishuCfg!, runtime: opts.runtime, abortSignal: opts.abortSignal });
  }

  log("feishu: webhook mode not implemented in monitor, use HTTP server directly");
}

async function monitorWebSocket(params: {
  cfg: ClawdbotConfig;
  feishuCfg: FeishuConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
}): Promise<void> {
  const { cfg, feishuCfg, runtime, abortSignal } = params;
  const log = runtime?.log ?? console.log;
  const error = runtime?.error ?? console.error;

  log("feishu: starting WebSocket connection...");

  const wsClient = createFeishuWSClient(feishuCfg);
  currentWsClient = wsClient;

  const chatHistories = new Map<string, HistoryEntry[]>();

  const eventDispatcher = createEventDispatcher(feishuCfg);

  // Generic handler for events mapped in config
  const handleGenericEvent = async (key: string, data: any) => {
    // Check config.channels.feishu.events[key]
    const script = feishuCfg.events?.[key];
    if (script) {
      log(`feishu: routing event '${key}' to script: ${script}`);
      executeScript(script, data, log, error);
      return true;
    }
    return false;
  };

  eventDispatcher.register({
    "im.message.receive_v1": async (data) => {
      try {
        const event = data as unknown as FeishuMessageEvent;
        await handleFeishuMessage({
          cfg,
          event,
          botOpenId,
          runtime,
          chatHistories,
        });
      } catch (err) {
        error(`feishu: error handling message event: ${String(err)}`);
      }
    },
    "im.message.message_read_v1": async () => {
      // Ignore read receipts
    },
    "im.chat.member.bot.added_v1": async (data) => {
      try {
        const event = data as unknown as FeishuBotAddedEvent;
        log(`feishu: bot added to chat ${event.chat_id}`);
      } catch (err) {
        error(`feishu: error handling bot added event: ${String(err)}`);
      }
    },
    "im.chat.member.bot.deleted_v1": async (data) => {
      try {
        const event = data as unknown as { chat_id: string };
        log(`feishu: bot removed from chat ${event.chat_id}`);
      } catch (err) {
        error(`feishu: error handling bot removed event: ${String(err)}`);
      }
    },
    "card.action.trigger": async (data) => {
      try {
        log(`feishu: card action received`);
        // Try generic handler first
        const handled = await handleGenericEvent("card.action.trigger", data);
        if (!handled) {
           log("feishu: unhandled card action (configure 'card.action.trigger' in events)");
        }
      } catch (err) {
        error(`feishu: error handling card action: ${String(err)}`);
      }
    },
    "application.bot.menu_v6": async (data) => {
      try {
        const event = data as unknown as { event_key: string };
        log(`feishu: menu event received: ${event.event_key}`);

        // 1. Check generic event mapping (PRIORITY)
        const handled = await handleGenericEvent("application.bot.menu_v6", data);
        if (handled) return;

        // 2. Check legacy menuEvents mapping
        const mappedCommand = feishuCfg.menuEvents?.[event.event_key];
        if (mappedCommand) {
          log(`feishu: executing mapped command for '${event.event_key}': ${mappedCommand}`);
          exec(mappedCommand, (err, stdout, stderr) => {
             if (err) {
               error(`feishu: command '${mappedCommand}' failed: ${err.message}`);
               return;
             }
             if (stdout) log(`feishu: cmd stdout: ${stdout.trim()}`);
             if (stderr) error(`feishu: cmd stderr: ${stderr.trim()}`);
          });
          return;
        }

        // 3. Hardcoded fallback
        if (event.event_key === "restart_gateway") {
          log("feishu: executing restart gateway command...");
          execSync("openclaw gateway restart", { stdio: "inherit" });
        }
      } catch (err) {
        error(`feishu: error handling menu event: ${String(err)}`);
      }
    },
  });

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      if (currentWsClient === wsClient) {
        currentWsClient = null;
      }
    };

    const handleAbort = () => {
      log("feishu: abort signal received, stopping WebSocket client");
      cleanup();
      resolve();
    };

    if (abortSignal?.aborted) {
      cleanup();
      resolve();
      return;
    }

    abortSignal?.addEventListener("abort", handleAbort, { once: true });

    try {
      wsClient.start({
        eventDispatcher,
      });

      log("feishu: WebSocket client started");
    } catch (err) {
      cleanup();
      abortSignal?.removeEventListener("abort", handleAbort);
      reject(err);
    }
  });
}

export function stopFeishuMonitor(): void {
  if (currentWsClient) {
    currentWsClient = null;
  }
}
