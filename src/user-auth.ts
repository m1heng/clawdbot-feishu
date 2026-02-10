import http from "node:http";
import crypto from "node:crypto";
import { userTokenStore, resolveApiBaseUrl, resolveAuthorizeBaseUrl, type UserTokenInfo } from "./user-token.js";
import type { ResolvedFeishuAccount } from "./types.js";

// ============ Types ============

export interface UserAuthConfig {
  enabled?: boolean;
  callbackPort?: number; // default: 16688
  callbackHost?: string; // default: localhost
  callbackPath?: string; // default: /feishu/user-auth/callback
  scopes?: string[];
  tokenStorePath?: string; // file path for token persistence
}

// ============ Defaults ============

const DEFAULT_CALLBACK_PORT = 16688;
const DEFAULT_CALLBACK_PATH = "/feishu/user-auth/callback";
const DEFAULT_CALLBACK_HOST = "localhost";

const DEFAULT_SCOPES = [
  "search:docs:read",
  "minutes:minutes.transcript:export",
  "wiki:node:read",
  "wiki:wiki:readonly",
  "docs:document.content:read",
  "docx:document:readonly",
];

// ============ CSRF Nonce Management ============

/** Pending auth nonces for CSRF protection (one-time use) */
const pendingNonces = new Map<string, { openId: string; accountId: string; createdAt: number }>();

/** Nonce expiry time: 10 minutes */
const NONCE_TTL_MS = 10 * 60 * 1000;

function generateNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

function cleanExpiredNonces(): void {
  const now = Date.now();
  for (const [nonce, info] of pendingNonces) {
    if (now - info.createdAt > NONCE_TTL_MS) {
      pendingNonces.delete(nonce);
    }
  }
}

// ============ OAuth URL Builder ============

/**
 * Build the OAuth authorize URL for a user.
 * The state parameter encodes openId, accountId, and a CSRF nonce.
 */
export function buildAuthorizeUrl(
  openId: string,
  account: ResolvedFeishuAccount,
  config: UserAuthConfig,
): string {
  cleanExpiredNonces();

  const nonce = generateNonce();
  pendingNonces.set(nonce, {
    openId,
    accountId: account.accountId,
    createdAt: Date.now(),
  });

  const host = config.callbackHost ?? DEFAULT_CALLBACK_HOST;
  const port = config.callbackPort ?? DEFAULT_CALLBACK_PORT;
  const callbackPath = config.callbackPath ?? DEFAULT_CALLBACK_PATH;
  const scopes = config.scopes ?? DEFAULT_SCOPES;

  // Build redirect_uri
  const protocol = host === "localhost" || host === "127.0.0.1" ? "http" : "https";
  const redirectUri = `${protocol}://${host}:${port}${callbackPath}`;

  // Build state
  const state = Buffer.from(
    JSON.stringify({ openId, accountId: account.accountId, nonce }),
  ).toString("base64url");

  // Build authorize URL
  const baseUrl = resolveAuthorizeBaseUrl(account.domain);
  const url = new URL(`${baseUrl}/open-apis/authen/v1/authorize`);
  url.searchParams.set("client_id", account.appId!);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", state);

  return url.toString();
}

// ============ Callback Server ============

let callbackServer: http.Server | null = null;

/**
 * Start the OAuth callback HTTP server.
 * Handles the redirect from Feishu OAuth, exchanges code for token, stores it.
 */
export function startAuthCallbackServer(
  account: ResolvedFeishuAccount,
  config: UserAuthConfig,
  logger?: { info?: (...args: any[]) => void; error?: (...args: any[]) => void },
): http.Server {
  if (callbackServer) {
    return callbackServer;
  }

  const port = config.callbackPort ?? DEFAULT_CALLBACK_PORT;
  const callbackPath = config.callbackPath ?? DEFAULT_CALLBACK_PATH;
  const host = config.callbackHost ?? DEFAULT_CALLBACK_HOST;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    // Only handle the callback path
    if (url.pathname !== callbackPath) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    const code = url.searchParams.get("code");
    const stateRaw = url.searchParams.get("state");

    if (!code || !stateRaw) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(errorHtml("Missing code or state parameter"));
      return;
    }

    // Decode and validate state
    let stateData: { openId: string; accountId: string; nonce: string };
    try {
      stateData = JSON.parse(Buffer.from(stateRaw, "base64url").toString("utf-8"));
    } catch {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(errorHtml("Invalid state parameter"));
      return;
    }

    // Validate nonce (CSRF protection)
    const nonceInfo = pendingNonces.get(stateData.nonce);
    if (!nonceInfo) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(errorHtml("Invalid or expired authorization request. Please try again."));
      return;
    }

    // Consume nonce (one-time use)
    pendingNonces.delete(stateData.nonce);

    // Verify nonce matches
    if (nonceInfo.openId !== stateData.openId || nonceInfo.accountId !== stateData.accountId) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(errorHtml("State mismatch. Please try again."));
      return;
    }

    // Exchange code for token
    try {
      const protocol = host === "localhost" || host === "127.0.0.1" ? "http" : "https";
      const redirectUri = `${protocol}://${host}:${port}${callbackPath}`;
      const baseUrl = resolveApiBaseUrl(account.domain);

      const tokenResponse = await fetch(`${baseUrl}/open-apis/authen/v2/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: account.appId,
          client_secret: account.appSecret,
          code,
          redirect_uri: redirectUri,
        }),
      });

      const tokenResult = (await tokenResponse.json()) as {
        code?: number;
        msg?: string;
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
      };

      if (tokenResult.code !== 0 || !tokenResult.access_token) {
        logger?.error?.(
          `[UserAuth] Token exchange failed for ${stateData.openId}:`,
          tokenResult.msg ?? "unknown error",
        );
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end(errorHtml(`Authorization failed: ${tokenResult.msg ?? "unknown error"}`));
        return;
      }

      // Store token
      const tokenInfo: UserTokenInfo = {
        access_token: tokenResult.access_token,
        refresh_token: tokenResult.refresh_token,
        expires_at: Date.now() + (tokenResult.expires_in ?? 6900) * 1000,
        scope: tokenResult.scope,
      };

      userTokenStore.setToken(stateData.openId, tokenInfo);

      logger?.info?.(
        `[UserAuth] Authorization successful for user ${stateData.openId}, ` +
          `token expires at ${new Date(tokenInfo.expires_at).toLocaleString()}`,
      );

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(successHtml());
    } catch (err) {
      logger?.error?.("[UserAuth] Token exchange error:", err);
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      res.end(errorHtml("Internal server error during token exchange"));
    }
  });

  const listenHost = host === "localhost" ? "127.0.0.1" : "0.0.0.0";
  server.listen(port, listenHost, () => {
    logger?.info?.(`[UserAuth] Callback server started on ${listenHost}:${port}`);
  });

  server.on("error", (err) => {
    logger?.error?.("[UserAuth] Callback server error:", err);
  });

  callbackServer = server;
  return server;
}

/**
 * Stop the callback server if running.
 */
export function stopAuthCallbackServer(): void {
  if (callbackServer) {
    callbackServer.close();
    callbackServer = null;
  }
}

// ============ HTML Templates ============

function successHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Authorization Successful</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
    .container { text-align: center; padding: 40px; background: white; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .check { font-size: 48px; margin-bottom: 16px; }
    h2 { color: #333; margin: 0 0 10px; }
    p { color: #666; margin: 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="check">&#10004;</div>
    <h2>Authorization Successful</h2>
    <p>You can close this page and return to the chat.</p>
  </div>
</body>
</html>`;
}

function errorHtml(message: string): string {
  const escaped = message.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Authorization Failed</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
    .container { text-align: center; padding: 40px; background: white; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .cross { font-size: 48px; margin-bottom: 16px; color: #e53e3e; }
    h2 { color: #333; margin: 0 0 10px; }
    p { color: #666; margin: 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="cross">&#10008;</div>
    <h2>Authorization Failed</h2>
    <p>${escaped}</p>
  </div>
</body>
</html>`;
}
