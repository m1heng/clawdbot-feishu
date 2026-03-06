import type { ClawdbotConfig } from "openclaw/plugin-sdk";
// @ts-ignore - types not exported from main entry
import type { PluginHookSubagentSpawningEvent, PluginHookSubagentSpawningResult } from "openclaw/plugin-sdk/plugins/hooks";
import { sendMessageFeishu } from "./send.js";
import { resolveFeishuAccount } from "./accounts.js";

/**
 * Subagent context for Feishu channel.
 * Stores the chat context and provides sendMessage capability.
 */
export interface FeishuSubagentContext {
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
     */
    sendMessage: async (content: string) => {
      try {
        await sendMessageFeishu({
          cfg,
          to: chatId,
          text: content,
          accountId,
        });
      } catch (error) {
        console.error(`[Feishu] Failed to send subagent message:`, error);
        throw error;
      }
    },
    
    /**
     * Cleanup function called when subagent ends.
     */
    cleanup: async () => {
      console.log(`[Feishu] Subagent ${childSessionKey} cleaned up`);
      subagentContexts.delete(childSessionKey);
    },
  };
  
  // Store context for future message delivery
  subagentContexts.set(childSessionKey, context);
  
  console.log(`[Feishu] Subagent spawned: ${childSessionKey} -> chat: ${chatId}`);
  
  return {
    status: "ok",
    threadBindingReady: true,
  };
}

/**
 * Handle message delivery from subagent to parent chat.
 * This hook is called when a subagent wants to send a message.
 */
export async function handleSubagentMessage(
  childSessionKey: string,
  content: string
): Promise<void> {
  const context = subagentContexts.get(childSessionKey);
  if (!context) {
    console.warn(`[Feishu] No context found for subagent ${childSessionKey}`);
    return;
  }
  
  // Forward message to parent chat
  await context.sendMessage(content);
}

/**
 * Get subagent context by session key.
 */
export function getSubagentContext(sessionKey: string): FeishuSubagentContext | undefined {
  return subagentContexts.get(sessionKey);
}

/**
 * Clean up a subagent context.
 */
export async function cleanupSubagent(sessionKey: string): Promise<void> {
  const context = subagentContexts.get(sessionKey);
  if (context?.cleanup) {
    await context.cleanup();
  }
  subagentContexts.delete(sessionKey);
}
