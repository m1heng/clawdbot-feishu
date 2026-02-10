import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { listEnabledFeishuAccounts } from "./accounts.js";
import { resolveToolsConfig } from "./tools-config.js";
import { userTokenStore } from "./user-token.js";
import { buildAuthorizeUrl, startAuthCallbackServer, type UserAuthConfig } from "./user-auth.js";
import { FeishuUserAuthSchema, type FeishuUserAuthParams } from "./user-auth-schema.js";

// ============ Helpers ============

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

// ============ Tool Registration ============

export function registerFeishuUserAuthTools(api: OpenClawPluginApi) {
  if (!api.config) {
    api.logger.debug?.("feishu_user_auth: No config available, skipping");
    return;
  }

  const accounts = listEnabledFeishuAccounts(api.config);
  if (accounts.length === 0) {
    api.logger.debug?.("feishu_user_auth: No Feishu accounts configured, skipping");
    return;
  }

  const firstAccount = accounts[0];
  const toolsCfg = resolveToolsConfig(firstAccount.config.tools);
  if (!toolsCfg.userAuth) {
    api.logger.debug?.("feishu_user_auth: userAuth tool disabled in config");
    return;
  }

  // Resolve userAuth config
  const userAuthCfg: UserAuthConfig = (firstAccount.config as any).userAuth ?? {};

  // Initialize token store with custom path if configured
  if (userAuthCfg.tokenStorePath) {
    // Re-initialize the store with the custom path
    const { UserTokenStore } = require("./user-token.js") as typeof import("./user-token.js");
    const store = new UserTokenStore(userAuthCfg.tokenStorePath);
    // Copy tokens to singleton (the singleton is what tools use)
    // This is a workaround since the singleton is already created
    Object.assign(userTokenStore, { filePath: userAuthCfg.tokenStorePath });
    userTokenStore.load();
  }

  // Start the callback server
  startAuthCallbackServer(firstAccount, userAuthCfg, api.logger);

  api.registerTool(
    {
      name: "feishu_user_auth",
      label: "Feishu User Auth",
      description:
        "Manage user OAuth authorization for Feishu APIs that require user identity (search, minutes). " +
        "Actions: authorize (generate OAuth URL for user), status (check if user is authorized), " +
        "revoke (remove user's stored token). The open_id parameter is the user's Feishu Open ID from message context.",
      parameters: FeishuUserAuthSchema,
      async execute(_toolCallId, params) {
        const p = params as FeishuUserAuthParams;
        try {
          switch (p.action) {
            case "authorize": {
              const url = buildAuthorizeUrl(p.open_id, firstAccount, userAuthCfg);
              return json({
                authorize_url: url,
                message: `Please open the following URL to authorize: ${url}`,
              });
            }
            case "status": {
              const hasToken = userTokenStore.hasValidToken(p.open_id);
              const tokenInfo = userTokenStore.getToken(p.open_id);
              return json({
                authorized: hasToken,
                ...(tokenInfo && {
                  expires_at: tokenInfo.expires_at,
                  expires_in_minutes: Math.round((tokenInfo.expires_at - Date.now()) / 60000),
                  scope: tokenInfo.scope,
                }),
              });
            }
            case "revoke": {
              userTokenStore.removeToken(p.open_id);
              return json({
                success: true,
                message: "User token has been revoked.",
              });
            }
            default:
              return json({ error: `Unknown action: ${(p as any).action}` });
          }
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    { name: "feishu_user_auth" },
  );

  api.logger.info?.("feishu_user_auth: Registered feishu_user_auth tool (callback server started)");
}
