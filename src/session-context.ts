/**
 * Session context manager for Feishu plugin.
 * Stores current user information per session key so tools can access it.
 */

import fs from 'fs';
import path from 'path';

const DEBUG_LOG_FILE = '/tmp/feishu_debug.log';

function writeDebugLog(message: string, data?: any): void {
  try {
    const timestamp = new Date().toISOString();
    const logEntry = data ? `[${timestamp}] ${message} ${JSON.stringify(data)}\n` : `[${timestamp}] ${message}\n`;
    fs.appendFileSync(DEBUG_LOG_FILE, logEntry);
  } catch (err) {
    // Ignore file write errors
  }
}

interface SessionContext {
  senderOpenId?: string;
  senderId?: string;
  chatId?: string;
  chatType?: "direct" | "group";
  timestamp: number;
}

/**
 * Session context storage.
 * Key: sessionKey (from agent route)
 * Value: session context with sender information
 */
const sessionContexts = new Map<string, SessionContext>();

/**
 * Current session key (for tool execution)
 * This is set during message processing and accessed during tool execution
 */
let currentSessionKey: string | undefined;

/**
 * TTL for session context (5 minutes)
 */
const SESSION_TTL_MS = 5 * 60 * 1000;

/**
 * Set session context (called from message handler)
 */
export function setSessionContext(
  sessionKey: string,
  context: Omit<SessionContext, "timestamp">
): void {
  writeDebugLog(`[session-context] setSessionContext called`, { sessionKey, context });
  console.log(`[session-context] Setting context for ${sessionKey}:`, context);
  sessionContexts.set(sessionKey, {
    ...context,
    timestamp: Date.now(),
  });

  // Set current session key for tool execution
  currentSessionKey = sessionKey;
  writeDebugLog(`[session-context] currentSessionKey set to`, currentSessionKey);
  console.log(`[session-context] Set currentSessionKey to:`, currentSessionKey);

  // Clean up old entries periodically
  cleanupOldEntries();
}

/**
 * Get current session key
 */
export function getCurrentSessionKey(): string | undefined {
  return currentSessionKey;
}

/**
 * Get session context for a session key
 */
export function getSessionContext(sessionKey: string): SessionContext | undefined {
  const context = sessionContexts.get(sessionKey);
  if (!context) return undefined;

  // Check if expired
  if (Date.now() - context.timestamp > SESSION_TTL_MS) {
    sessionContexts.delete(sessionKey);
    return undefined;
  }

  return context;
}

/**
 * Get current session context
 */
export function getCurrentSessionContext(): SessionContext | undefined {
  if (!currentSessionKey) return undefined;
  return getSessionContext(currentSessionKey);
}

/**
 * Get current sender open ID
 */
export function getCurrentSenderOpenId(): string | undefined {
  const context = getCurrentSessionContext();
  writeDebugLog(`[session-context] getCurrentSenderOpenId called`, {
    hasContext: !!context,
    senderOpenId: context?.senderOpenId,
    currentSessionKey
  });
  console.log(`[session-context] getCurrentSenderOpenId called, returning:`, context?.senderOpenId, `currentSessionKey:`, currentSessionKey);
  return context?.senderOpenId;
}

/**
 * Clean up old entries
 */
function cleanupOldEntries(): void {
  const now = Date.now();
  for (const [key, context] of sessionContexts.entries()) {
    if (now - context.timestamp > SESSION_TTL_MS) {
      sessionContexts.delete(key);
    }
  }
}

/**
 * Clear all session contexts (for testing)
 */
export function clearAllSessionContexts(): void {
  sessionContexts.clear();
  currentSessionKey = undefined;
}
