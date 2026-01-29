import * as Lark from "@larksuiteoapi/node-sdk";
import http from "http";
import type { ClawdbotConfig, RuntimeEnv, HistoryEntry } from "clawdbot/plugin-sdk";
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

function registerEventHandlers(
  eventDispatcher: Lark.EventDispatcher,
  context: {
    cfg: ClawdbotConfig;
    botOpenId?: string;
    runtime?: RuntimeEnv;
    chatHistories: Map<string, HistoryEntry[]>;
  }
) {
  const { cfg, botOpenId, runtime, chatHistories } = context;
  const log = runtime?.log ?? console.log;
  const error = runtime?.error ?? console.error;

  eventDispatcher.register({
    "im.message.receive_v1": async (data) => {
      try {
        const event = data as unknown as FeishuMessageEvent;
        // Do not await to avoid blocking response (Lark requires <3s response)
        handleFeishuMessage({
          cfg,
          event,
          botOpenId,
          runtime,
          chatHistories,
        }).catch((err) => {
          error(`feishu: error handling message event: ${String(err)}`);
        });
      } catch (err) {
        error(`feishu: error dispatching message event: ${String(err)}`);
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
  });
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

  if (connectionMode === "webhook") {
    return monitorWebhook({ cfg, feishuCfg: feishuCfg!, runtime: opts.runtime, abortSignal: opts.abortSignal });
  }
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

  registerEventHandlers(eventDispatcher, {
    cfg,
    botOpenId,
    runtime,
    chatHistories,
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

async function monitorWebhook(params: {
  cfg: ClawdbotConfig;
  feishuCfg: FeishuConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
}): Promise<void> {
  const { cfg, feishuCfg, runtime, abortSignal } = params;
  const log = runtime?.log ?? console.log;
  const error = runtime?.error ?? console.error;

  const port = feishuCfg.webhookPort || 3000;
  const path = feishuCfg.webhookPath || "/webhook/event";

  log(`feishu: starting Webhook server on port ${port}, path ${path}...`);

  const eventDispatcher = createEventDispatcher(feishuCfg);
  const chatHistories = new Map<string, HistoryEntry[]>();

  registerEventHandlers(eventDispatcher, {
    cfg,
    botOpenId,
    runtime,
    chatHistories,
  });

  const server = http.createServer();
  server.on("request", Lark.adaptDefault(path, eventDispatcher, { autoChallenge: true }));

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      server.close();
    };

    const handleAbort = () => {
      log("feishu: abort signal received, stopping Webhook server");
      cleanup();
      resolve();
    };

    if (abortSignal?.aborted) {
      resolve();
      return;
    }

    abortSignal?.addEventListener("abort", handleAbort, { once: true });

    server.listen(port, () => {
      log(`feishu: Webhook server listening on port ${port}`);
    });

    server.on("error", (err) => {
      error(`feishu: Webhook server error: ${err}`);
      abortSignal?.removeEventListener("abort", handleAbort);
      reject(err);
    });
  });
}


export function stopFeishuMonitor(): void {
  if (currentWsClient) {
    currentWsClient = null;
  }
}
