import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { listEnabledFeishuAccounts } from "./accounts.js";
import { resolveToolsConfig } from "./tools-config.js";
import { userTokenStore } from "./user-token.js";
import { buildAuthorizeUrl, startAuthCallbackServer, getNonceFilePath, type UserAuthConfig } from "./user-auth.js";
import { createAuthFileLogger, getAuthLogFilePath } from "./user-auth-logger.js";
import { setAuthLogger } from "./feishu-auth-debug.js";
import { sendCardFeishu } from "./send.js";
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

  const userAuthCfg: UserAuthConfig = (firstAccount.config as Record<string, unknown>).userAuth as
    | UserAuthConfig
    | undefined
    ?? {};

  // Resolve paths and create file logger (log file next to token store or in system temp dir)
  const tokenStorePath = userAuthCfg.tokenStorePath
    ? path.resolve(userAuthCfg.tokenStorePath)
    : undefined;
  const logFilePath = getAuthLogFilePath(tokenStorePath);
  const logFilePathAbsolute = path.resolve(logFilePath);
  const authLogger = createAuthFileLogger(logFilePathAbsolute, api.logger);
  setAuthLogger(authLogger);

  // Initialize token store to configured path so tokens save where user expects
  if (tokenStorePath) {
    userTokenStore.reinitialize(tokenStorePath);
  }
  const actualTokenPath = userTokenStore.getFilePath();
  // Resolve nonce file path ONCE here — it will be passed explicitly to both
  // buildAuthorizeUrl (save nonce) and startAuthCallbackServer (consume nonce),
  // ensuring they always use the exact same path, regardless of module caching.
  const nonceFilePath = getNonceFilePath();

  const port = userAuthCfg.callbackPort ?? 16688;
  const host = userAuthCfg.callbackHost ?? "localhost";
  const protocol =
    userAuthCfg.callbackProtocol ??
    (host === "localhost" || host === "127.0.0.1" ? "http" : "https");
  const callbackPath = userAuthCfg.callbackPath ?? "/feishu/user-auth/callback";
  const redirectUri = `${protocol}://${host}:${port}${callbackPath}`;

  authLogger.info("feishu_user_auth tool registered", {
    tokenStorePathActual: actualTokenPath,
    nonceFilePath,
    authLogFilePath: logFilePathAbsolute,
    callbackHost: host,
    callbackPort: port,
    callbackProtocol: protocol,
    redirectUri,
    hint: "Ensure redirect_uri is whitelisted in Feishu Open Platform (OAuth redirect URL)",
  });

  api.logger.info?.("[UserAuth] 路径汇总 (paths):");
  api.logger.info?.(`  Token 存储路径 (token store): ${actualTokenPath}`);
  api.logger.info?.(`  授权日志路径 (auth log file): ${logFilePathAbsolute}`);
  api.logger.info?.(`  Nonce 文件路径 (nonce file): ${nonceFilePath}`);

  startAuthCallbackServer(firstAccount, userAuthCfg, nonceFilePath, authLogger);

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
              const url = buildAuthorizeUrl(p.open_id, firstAccount, userAuthCfg, nonceFilePath, authLogger);
              let dmSent = false;
              try {
                // Send as interactive card with button so Feishu does not
                // parse/truncate the accounts.feishu.cn URL.
                const authCard = {
                  schema: "2.0",
                  config: { wide_screen_mode: true },
                  header: {
                    title: { tag: "plain_text", content: "飞书授权请求" },
                    template: "blue",
                  },
                  body: {
                    elements: [
                      {
                        tag: "markdown",
                        content: "请点击下方按钮完成授权（10分钟内有效）",
                      },
                      {
                        tag: "action",
                        actions: [
                          {
                            tag: "button",
                            text: { tag: "plain_text", content: "点击授权" },
                            type: "primary",
                            multi_url: {
                              url,
                              pc_url: "",
                              android_url: "",
                              ios_url: "",
                            },
                          },
                        ],
                      },
                    ],
                  },
                };
                await sendCardFeishu({
                  cfg: api.config!,
                  to: p.open_id,
                  card: authCard,
                  accountId: firstAccount.accountId,
                });
                dmSent = true;
                authLogger.info("Authorize card sent to user via Feishu DM", {
                  openId: p.open_id,
                });
              } catch (dmErr) {
                authLogger.error("Failed to send authorize card via DM (returning URL in tool result)", {
                  openId: p.open_id,
                  error: dmErr instanceof Error ? dmErr.message : String(dmErr),
                });
              }

              return json({
                authorize_url: url,
                message: `Please open the following URL to authorize: ${url}`,
                dm_sent: dmSent,
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
              return json({ error: `Unknown action: ${(p as { action: string }).action}` });
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
