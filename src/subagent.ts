import type {ClawdbotConfig, OpenClawPluginApi} from "openclaw/plugin-sdk";
// @ts-ignore - types not exported from main entry
import type { PluginHookSubagentSpawningEvent, PluginHookSubagentSpawningResult, PluginHookSubagentEndedEvent } from "openclaw/plugin-sdk/plugins/hooks";
import { sendMessageFeishu } from "./send.js";
import { resolveFeishuAccount } from "./accounts.js";

const LOG_PREFIX = "[Feishu Subagent]";

/**
 * Subagent context for Feishu channel.
 * Stores the chat context and provides sendMessage capability.
 */
interface FeishuSubagentContext {
  sessionKey: string;
  chatId: string;
  accountId?: string;
  cfg: ClawdbotConfig;
  sendMessage: (content: string) => Promise<void>;
  cleanup?: () => Promise<void>;
}

/**
 * Store active subagent contexts.
 * Key: childSessionKey (e.g., "agent:main:subagent:xxx")
 */
const subagentContexts = new Map<string, FeishuSubagentContext>();

/**
 * Rate limiter with queue-based concurrency control.
 * Limits to 1 message per 500ms per chatId, with proper locking.
 */
const sendRateLimitMs = 500;
const sendLocks = new Map<string, Promise<void>>();
const lastSendTime = new Map<string, number>();

/**
 * Handle subagent spawning request.
 * Creates a context that allows the subagent to send messages to the parent chat.
 */
export async function handleSubagentSpawning(
  event: PluginHookSubagentSpawningEvent,
  cfg: ClawdbotConfig
): Promise<PluginHookSubagentSpawningResult> {
  const { childSessionKey, requester } = event;
  
  // Extract chat context from requester
  const chatId = requester?.threadId || requester?.to;
  const accountId = requester?.accountId;
  
  if (!chatId) {
    return {
      status: "error",
      error: "No chat context available for subagent spawning. Missing threadId or to in requester context.",
    };
  }
  
  // Verify the account is configured
  const account = accountId ? resolveFeishuAccount({ cfg, accountId }) : null;
  if (accountId && !account?.configured) {
    return {
      status: "error",
      error: `Feishu account "${accountId}" not configured`,
    };
  }
  
  // Create subagent context with sendMessage capability
  const context: FeishuSubagentContext = {
    sessionKey: childSessionKey,
    chatId,
    accountId,
    cfg,
    
    /**
     * Send a message from the subagent to the parent chat.
     * This is the core function that enables subagent communication.
     * Includes rate limiting with queue-based concurrency control (max 1 msg / 500ms).
     */
    sendMessage: async (content: string) => {
      // Wait for any pending send to complete (queue-based locking)
      const pendingSend = sendLocks.get(chatId);
      if (pendingSend) {
        await pendingSend;
      }
      
      // Create a promise for this send operation
      const sendPromise = (async () => {
        const now = Date.now();
        const lastTime = lastSendTime.get(chatId) || 0;
        const delay = Math.max(0, sendRateLimitMs - (now - lastTime));
        
        if (delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        try {
          await sendMessageFeishu({
            cfg,
            to: chatId,
            text: content,
            accountId,
          });
          lastSendTime.set(chatId, Date.now());
        } catch (error) {
          console.error(`${LOG_PREFIX} Failed to send message:`, error);
          throw error;
        } finally {
          // Clean up the lock
          if (sendLocks.get(chatId) === sendPromise) {
            sendLocks.delete(chatId);
          }
        }
      })();
      
      // Store the promise for concurrent call detection
      sendLocks.set(chatId, sendPromise);
      
      // Wait for this send to complete
      await sendPromise;
    },
    
    /**
     * Cleanup function called when subagent ends.
     */
    cleanup: async () => {
      console.log(`${LOG_PREFIX} Subagent ${childSessionKey} cleaned up`);
      subagentContexts.delete(childSessionKey);
    },
  };
  
  // Store context for future message delivery
  subagentContexts.set(childSessionKey, context);
  
  console.log(`${LOG_PREFIX} Spawned: ${childSessionKey} -> chat: ${chatId}`);
  
  return {
    status: "ok",
    threadBindingReady: true,
  };
}

/**
 * Handle subagent ended event.
 * Automatically cleans up the subagent context to prevent memory leaks.
 */
export async function handleSubagentEnded(event: PluginHookSubagentEndedEvent): Promise<void> {
  const { targetSessionKey, reason } = event;
  const context = subagentContexts.get(targetSessionKey);
  
  if (context?.cleanup) {
    await context.cleanup();
  } else {
    // Fallback: just delete from map if no cleanup function
    subagentContexts.delete(targetSessionKey);
    console.log(`${LOG_PREFIX} Cleaned up (ended): ${targetSessionKey}, reason: ${reason}`);
  }
}

/**
 * Clean up a subagent context by session key.
 * Called automatically when subagent ends.
 */
async function cleanupSubagent(sessionKey: string): Promise<void> {
  const context = subagentContexts.get(sessionKey);
  if (context?.cleanup) {
    await context.cleanup();
  }
  subagentContexts.delete(sessionKey);
}

export function registerFeishuSubagentTools(api: OpenClawPluginApi) {
  if (!api.config) {
    api.logger.debug?.("feishu_subagent: No config available, skipping subagent config");
    return;
  }

  // Register subagent spawning hook to support mode="session" + thread=true
  api.on("subagent_spawning", async (event: PluginHookSubagentSpawningEvent) => {
    return handleSubagentSpawning(event, api.config);
  });

  // Register subagent ended hook for automatic cleanup (prevents memory leaks)
  api.on("subagent_ended", async (event: PluginHookSubagentEndedEvent) => {
    await handleSubagentEnded(event);
  });
}
