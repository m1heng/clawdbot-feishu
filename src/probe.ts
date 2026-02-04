import type { FeishuConfig, FeishuProbeResult } from "./types.js";
import { createFeishuClient } from "./client.js";
import { resolveFeishuCredentials } from "./accounts.js";
import { getCachedProbeResult, setCachedProbeResult } from "./probe-cache.js";

export async function probeFeishu(cfg?: FeishuConfig): Promise<FeishuProbeResult> {
  const creds = resolveFeishuCredentials(cfg);
  if (!creds) {
    return {
      ok: false,
      error: "missing credentials (appId, appSecret)",
    };
  }

  // Check cache first
  const cached = getCachedProbeResult(creds.appId);
  if (cached) {
    return cached;
  }

  // Perform actual probe
  let result: FeishuProbeResult;
  
  try {
    const client = createFeishuClient(cfg!);
    // Use im.chat.list as a simple connectivity test
    // The bot info API path varies by SDK version
    const response = await (client as any).request({
      method: "GET",
      url: "/open-apis/bot/v3/info",
      data: {},
    });

    if (response.code !== 0) {
      result = {
        ok: false,
        appId: creds.appId,
        error: `API error: ${response.msg || `code ${response.code}`}`,
      };
    } else {
      const bot = response.bot || response.data?.bot;
      result = {
        ok: true,
        appId: creds.appId,
        botName: bot?.bot_name,
        botOpenId: bot?.open_id,
      };
    }
  } catch (err) {
    result = {
      ok: false,
      appId: creds.appId,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Cache the result
  setCachedProbeResult(result, creds.appId);
  
  return result;
}
