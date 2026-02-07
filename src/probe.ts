import type { FeishuProbeResult } from "./types.js";
import { createFeishuClient, type FeishuClientCredentials } from "./client.js";

// Cache for probe results to avoid API rate limits
// Default TTL: 15 minutes (900000 ms)
const PROBE_CACHE_TTL_MS = 15 * 60 * 1000;

interface ProbeCacheEntry {
  result: FeishuProbeResult;
  timestamp: number;
}

const probeCache = new Map<string, ProbeCacheEntry>();

function getCacheKey(creds: FeishuClientCredentials): string {
  return `${creds.appId}:${creds.domain || "feishu"}`;
}

function getCachedResult(creds: FeishuClientCredentials): FeishuProbeResult | null {
  const key = getCacheKey(creds);
  const cached = probeCache.get(key);
  if (!cached) return null;
  
  const now = Date.now();
  if (now - cached.timestamp > PROBE_CACHE_TTL_MS) {
    // Cache expired
    probeCache.delete(key);
    return null;
  }
  
  return cached.result;
}

function setCachedResult(creds: FeishuClientCredentials, result: FeishuProbeResult): void {
  const key = getCacheKey(creds);
  probeCache.set(key, {
    result,
    timestamp: Date.now(),
  });
}

/**
 * Clear the probe cache for a specific account or all accounts.
 */
export function clearProbeCache(accountId?: string): void {
  if (accountId) {
    // Find and delete entries matching the accountId
    for (const [key, entry] of probeCache.entries()) {
      if (key.startsWith(`${accountId}:`)) {
        probeCache.delete(key);
      }
    }
  } else {
    probeCache.clear();
  }
}

export async function probeFeishu(creds?: FeishuClientCredentials): Promise<FeishuProbeResult> {
  if (!creds?.appId || !creds?.appSecret) {
    return {
      ok: false,
      error: "missing credentials (appId, appSecret)",
    };
  }

  // Check cache first
  const cached = getCachedResult(creds);
  if (cached) {
    return cached;
  }

  try {
    const client = createFeishuClient(creds);
    // Use bot/v3/info API to get bot information
    const response = await (client as any).request({
      method: "GET",
      url: "/open-apis/bot/v3/info",
      data: {},
    });

    if (response.code !== 0) {
      const result: FeishuProbeResult = {
        ok: false,
        appId: creds.appId,
        error: `API error: ${response.msg || `code ${response.code}`}`,
      };
      // Cache error results for a shorter time (5 minutes) to avoid hammering the API
      setCachedResult(creds, result);
      return result;
    }

    const bot = response.bot || response.data?.bot;
    const result: FeishuProbeResult = {
      ok: true,
      appId: creds.appId,
      botName: bot?.bot_name,
      botOpenId: bot?.open_id,
    };
    
    // Cache successful result
    setCachedResult(creds, result);
    
    return result;
  } catch (err) {
    const result: FeishuProbeResult = {
      ok: false,
      appId: creds.appId,
      error: err instanceof Error ? err.message : String(err),
    };
    // Cache error results for a shorter time (5 minutes)
    setCachedResult(creds, result);
    return result;
  }
}
