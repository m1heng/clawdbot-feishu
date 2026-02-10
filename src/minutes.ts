import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createFeishuClient } from "./client.js";
import { listEnabledFeishuAccounts } from "./accounts.js";
import { resolveToolsConfig } from "./tools-config.js";
import { userTokenStore, resolveApiBaseUrl } from "./user-token.js";
import { FeishuMinutesSchema, type FeishuMinutesParams } from "./minutes-schema.js";

// ============ Helpers ============

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

// ============ Error Codes ============

const ERROR_CODE_MAP: Record<number, string> = {
  2091001: "Invalid parameters",
  2091002: "Minutes not found, check the token",
  2091003: "Minutes transcription not yet complete, try again later",
  2091004: "Minutes has been deleted",
  2091005: "No export permission, check minutes permission settings",
  2091006: "Internal server error, try again later",
};

/** Error codes that may be resolved by falling back to tenant (app) token */
const FALLBACK_ERROR_CODES = new Set([2091005]);

// ============ Core Functions ============

interface FetchTranscriptResult {
  success: boolean;
  text?: string;
  errorCode?: number;
  errorMsg?: string;
}

async function fetchTranscript(
  accessToken: string,
  minutesToken: string,
  needSpeaker: boolean,
  needTimestamp: boolean,
  fileFormat: string,
  apiBaseUrl: string,
): Promise<FetchTranscriptResult> {
  const url = new URL(`${apiBaseUrl}/open-apis/minutes/v1/minutes/${minutesToken}/transcript`);
  url.searchParams.set("need_speaker", String(needSpeaker));
  url.searchParams.set("need_timestamp", String(needTimestamp));
  url.searchParams.set("file_format", fileFormat);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const contentType = response.headers.get("content-type") || "";

  if (!response.ok || contentType.includes("application/json")) {
    const errorResult = (await response.json()) as { code: number; msg: string };
    return {
      success: false,
      errorCode: errorResult.code,
      errorMsg: ERROR_CODE_MAP[errorResult.code] || errorResult.msg || "Unknown error",
    };
  }

  // Successful response is a binary/text stream
  const transcriptText = await response.text();
  return { success: true, text: transcriptText };
}

/**
 * Get a tenant access token from the Feishu client.
 * The SDK manages tenant tokens internally; we need to get one for raw API calls.
 */
async function getTenantAccessToken(
  appId: string,
  appSecret: string,
  apiBaseUrl: string,
): Promise<string> {
  const response = await fetch(`${apiBaseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });

  const result = (await response.json()) as {
    code: number;
    msg: string;
    tenant_access_token?: string;
  };

  if (result.code !== 0 || !result.tenant_access_token) {
    throw new Error(`Failed to get tenant access token: [${result.code}] ${result.msg}`);
  }

  return result.tenant_access_token;
}

// ============ Tool Registration ============

export function registerFeishuMinutesTools(api: OpenClawPluginApi) {
  if (!api.config) {
    api.logger.debug?.("feishu_minutes: No config available, skipping");
    return;
  }

  const accounts = listEnabledFeishuAccounts(api.config);
  if (accounts.length === 0) {
    api.logger.debug?.("feishu_minutes: No Feishu accounts configured, skipping");
    return;
  }

  const firstAccount = accounts[0];
  const toolsCfg = resolveToolsConfig(firstAccount.config.tools);
  if (!toolsCfg.minutes) {
    api.logger.debug?.("feishu_minutes: minutes tool disabled in config");
    return;
  }

  const apiBaseUrl = resolveApiBaseUrl(firstAccount.domain);

  api.registerTool(
    {
      name: "feishu_minutes",
      label: "Feishu Minutes",
      description:
        "Get the transcript of a Feishu Minutes recording. " +
        "Requires the minutes_token (24 characters from the minutes URL) and the user's open_id. " +
        "Uses the user's OAuth token if available, falls back to app token if permission allows.",
      parameters: FeishuMinutesSchema,
      async execute(_toolCallId, params) {
        const p = params as FeishuMinutesParams;
        try {
          const needSpeaker = p.need_speaker ?? true;
          const needTimestamp = p.need_timestamp ?? false;
          const fileFormat = p.file_format ?? "txt";

          let usedTenantToken = false;

          // Try user token first
          const userAccessToken = await userTokenStore.getValidAccessToken(
            p.open_id,
            firstAccount.appId!,
            firstAccount.appSecret!,
            firstAccount.domain,
          );

          let result: FetchTranscriptResult;

          if (userAccessToken) {
            result = await fetchTranscript(
              userAccessToken,
              p.minutes_token,
              needSpeaker,
              needTimestamp,
              fileFormat,
              apiBaseUrl,
            );
          } else {
            // No user token available, try tenant token directly
            result = { success: false, errorCode: 2091005, errorMsg: "No user token" };
          }

          // If user token failed with fallback-eligible error, try tenant token
          if (!result.success && result.errorCode && FALLBACK_ERROR_CODES.has(result.errorCode)) {
            try {
              const tenantToken = await getTenantAccessToken(
                firstAccount.appId!,
                firstAccount.appSecret!,
                apiBaseUrl,
              );
              result = await fetchTranscript(
                tenantToken,
                p.minutes_token,
                needSpeaker,
                needTimestamp,
                fileFormat,
                apiBaseUrl,
              );
              if (result.success) {
                usedTenantToken = true;
              }
            } catch {
              // Tenant fallback failed, keep original error
            }
          }

          if (!result.success) {
            const hint =
              !userAccessToken
                ? " The user has not authorized yet. Use feishu_user_auth with action: 'authorize' to get an OAuth URL."
                : "";
            return json({
              error: `Failed to get minutes transcript: [${result.errorCode}] ${result.errorMsg}${hint}`,
            });
          }

          const transcriptText = result.text || "";
          if (!transcriptText.trim()) {
            return json({ message: "This minutes recording has no transcript content." });
          }

          return {
            content: [
              {
                type: "text" as const,
                text:
                  transcriptText +
                  (usedTenantToken
                    ? "\n\n---\nNote: Retrieved using app identity (user does not have direct access)."
                    : ""),
              },
            ],
          };
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    { name: "feishu_minutes" },
  );

  api.logger.info?.("feishu_minutes: Registered feishu_minutes tool");
}
