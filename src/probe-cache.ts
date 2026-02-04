import type { FeishuProbeResult } from "./types.js";

interface CacheEntry {
  result: FeishuProbeResult;
  timestamp: number;
}

/**
 * Cache duration in milliseconds
 * - Success: 5 minutes (avoid excessive API calls)
 * - Failure: 1 minute (detect recovery faster)
 */
const SUCCESS_CACHE_MS = 5 * 60 * 1000; // 5 minutes
const FAILURE_CACHE_MS = 1 * 60 * 1000; // 1 minute

const cache = new Map<string, CacheEntry>();

function getCacheKey(appId?: string): string {
  return `probe:${appId ?? "default"}`;
}

export function getCachedProbeResult(appId?: string): FeishuProbeResult | null {
  const key = getCacheKey(appId);
  const entry = cache.get(key);
  
  if (!entry) {
    return null;
  }

  const now = Date.now();
  const maxAge = entry.result.ok ? SUCCESS_CACHE_MS : FAILURE_CACHE_MS;
  
  if (now - entry.timestamp > maxAge) {
    cache.delete(key);
    return null;
  }

  return entry.result;
}

export function setCachedProbeResult(result: FeishuProbeResult, appId?: string): void {
  const key = getCacheKey(appId);
  cache.set(key, {
    result,
    timestamp: Date.now(),
  });
}

export function clearProbeCache(appId?: string): void {
  if (appId) {
    cache.delete(getCacheKey(appId));
  } else {
    cache.clear();
  }
}
