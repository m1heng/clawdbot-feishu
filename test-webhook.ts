import fs from "fs";
import path from "path";
import { monitorFeishuProvider } from "./src/monitor.js";
import { setFeishuRuntime } from "./src/runtime.js";

// Load .env from pythondemo/.env
const envPath = path.resolve("pythondemo/.env");
if (fs.existsSync(envPath)) {
  console.log(`Loading env from ${envPath}`);
  const content = fs.readFileSync(envPath, "utf-8");
  content.split("\n").forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();
      process.env[key] = value;
    }
  });
} else {
  console.warn(`Env file not found at ${envPath}`);
}

const config = {
  channels: {
    feishu: {
      appId: process.env.APP_ID,
      appSecret: process.env.APP_SECRET,
      encryptKey: process.env.ENCRYPT_KEY,
      verificationToken: process.env.VERIFICATION_TOKEN,
      domain: "lark",
      connectionMode: "webhook",
      webhookPort: 3000,
      webhookPath: "/webhook/event"
    }
  }
};

const runtime = {
  log: (...args: any[]) => console.log("[TEST]", ...args),
  error: (...args: any[]) => console.error("[TEST ERROR]", ...args),
  channel: {
    routing: {
      resolveAgentRoute: () => ({
        sessionKey: "test-session",
        accountId: "test-account",
        agentId: "test-agent"
      })
    },
    reply: {
      resolveEnvelopeFormatOptions: () => ({}),
      formatAgentEnvelope: (params: any) => params.body,
      finalizeInboundContext: (params: any) => params,
      dispatchReplyFromConfig: async () => ({ queuedFinal: true, counts: { final: 1 } }),
      createReplyDispatcherWithTyping: (params: any) => ({
        dispatcher: {},
        replyOptions: {},
        markDispatchIdle: () => {}
      }),
      resolveHumanDelayConfig: () => ({})
    },
    text: {
      resolveTextChunkLimit: () => 4000,
      resolveChunkMode: () => "length",
      resolveMarkdownTableMode: () => "native",
      convertMarkdownTables: (text: string) => text,
      chunkTextWithMode: (text: string) => [text]
    }
  },
  system: {
    enqueueSystemEvent: (msg: string) => console.log("[SYSTEM EVENT]", msg)
  }
};

// Initialize runtime
setFeishuRuntime(runtime as any);

console.log("Starting test webhook server...");
console.log("Config:", JSON.stringify(config.channels.feishu, null, 2));

// Mocking required parts of ClawdbotConfig if needed by validation
// But we cast to any for simplicity in this test script
monitorFeishuProvider({
  config: config as any,
  runtime: runtime as any,
  abortSignal: new AbortController().signal
}).catch(err => {
  console.error("Failed to start monitor:", err);
});

// Keep process alive
setInterval(() => {}, 1000);
