import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { userTokenStore, resolveApiBaseUrl, resolveAuthorizeBaseUrl, type UserTokenInfo } from "./user-token.js";
import type { ResolvedFeishuAccount } from "./types.js";

// ============ Types ============

export interface UserAuthConfig {
  enabled?: boolean;
  callbackPort?: number; // default: 16688
  callbackHost?: string; // default: localhost
  /** "http" or "https". If not set: localhost/127.0.0.1 use http, otherwise https. Set to "http" for remote servers without HTTPS. */
  callbackProtocol?: "http" | "https";
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

// ============ Logging Helpers ============

type UserAuthLogger = { info?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void };

/** Serialize error for logging (message + code + stack). Ensures logger always gets a string. */
function formatErr(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    const part = [err.message, code ? `code=${code}` : "", err.stack].filter(Boolean).join(" | ");
    return part;
  }
  return String(err);
}

function logInfo(logger: UserAuthLogger | undefined, msg: string, detail?: Record<string, unknown>): void {
  if (!logger?.info) return;
  (logger as { info: (msg: string, detail?: Record<string, unknown>) => void }).info(msg, detail);
}

function logError(
  logger: UserAuthLogger | undefined,
  msg: string,
  detailOrErr?: Record<string, unknown> | unknown,
): void {
  if (!logger?.error) return;
  const detail: Record<string, unknown> | undefined =
    detailOrErr === undefined
      ? undefined
      : typeof detailOrErr === "object" &&
        detailOrErr !== null &&
        !(detailOrErr instanceof Error) &&
        !Array.isArray(detailOrErr)
      ? (detailOrErr as Record<string, unknown>)
      : { error: formatErr(detailOrErr) };
  (logger as { error: (msg: string, detail?: Record<string, unknown>) => void }).error(msg, detail);
}

// ============ CSRF Nonce Management (file-persisted for restart / multi-instance) ============

/** Nonce expiry time: 10 minutes */
const NONCE_TTL_MS = 10 * 60 * 1000;

const DEFAULT_NONCE_FILE = ".feishu-pending-nonces.json";

export function getNonceFilePath(config: UserAuthConfig): string {
  // Use the actual resolved token file path so nonce file sits alongside the token file,
  // even if tokenStorePath was a directory that got resolved.
  const tokenFilePath = userTokenStore.getFilePath();
  return path.join(path.dirname(tokenFilePath), "feishu-pending-nonces.json");
}

type NonceEntry = { openId: string; accountId: string; createdAt: number };

function loadPendingNonces(filePath: string): Map<string, NonceEntry> {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(raw) as Record<string, NonceEntry>;
      return new Map(Object.entries(data));
    }
  } catch {
    // ignore
  }
  return new Map();
}

function savePendingNonces(filePath: string, map: Map<string, NonceEntry>): void {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = Object.fromEntries(map);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch {
    // best effort
  }
}

function generateNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

/** Add a nonce (persisted to file so callback works after restart or on another instance). */
function addPendingNonce(
  config: UserAuthConfig,
  nonce: string,
  openId: string,
  accountId: string,
): void {
  const filePath = getNonceFilePath(config);
  const map = loadPendingNonces(filePath);
  const now = Date.now();
  // Remove expired entries before adding
  for (const [n, info] of map) {
    if (now - info.createdAt > NONCE_TTL_MS) {
      map.delete(n);
    }
  }
  map.set(nonce, { openId, accountId, createdAt: now });
  savePendingNonces(filePath, map);
}

/**
 * Consume a nonce: validate, remove from store, return openId/accountId.
 * Returns null if nonce missing or expired.
 */
function consumePendingNonce(
  config: UserAuthConfig,
  nonce: string,
): { openId: string; accountId: string } | null {
  const filePath = getNonceFilePath(config);
  const map = loadPendingNonces(filePath);
  const info = map.get(nonce);
  if (!info) {
    return null;
  }
  const now = Date.now();
  if (now - info.createdAt > NONCE_TTL_MS) {
    map.delete(nonce);
    savePendingNonces(filePath, map);
    return null;
  }
  map.delete(nonce);
  savePendingNonces(filePath, map);
  return { openId: info.openId, accountId: info.accountId };
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
  const nonce = generateNonce();
  addPendingNonce(config, nonce, openId, account.accountId);

  const host = config.callbackHost ?? DEFAULT_CALLBACK_HOST;
  const port = config.callbackPort ?? DEFAULT_CALLBACK_PORT;
  const callbackPath = config.callbackPath ?? DEFAULT_CALLBACK_PATH;
  const scopes = config.scopes ?? DEFAULT_SCOPES;

  // Build redirect_uri: use callbackProtocol if set, else http for localhost only
  const protocol =
    config.callbackProtocol ??
    (host === "localhost" || host === "127.0.0.1" ? "http" : "https");
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

    logInfo(logger, "[STEP 1/5] Received callback request", {
      method: req.method,
      path: url.pathname,
      pathMatch: url.pathname === callbackPath,
    });

    // Only handle the callback path
    if (url.pathname !== callbackPath) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    const code = url.searchParams.get("code");
    const stateRaw = url.searchParams.get("state");

    logInfo(logger, "[STEP 1/5] Callback query params", {
      hasCode: Boolean(code),
      codeLength: code?.length ?? 0,
      hasState: Boolean(stateRaw),
      stateLength: stateRaw?.length ?? 0,
    });

    if (!code || !stateRaw) {
      logError(logger, "[STEP 1/5] Missing code or state in callback");
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(errorHtml("Missing code or state parameter"));
      return;
    }

    // Decode and validate state
    let stateData: { openId: string; accountId: string; nonce: string };
    try {
      stateData = JSON.parse(Buffer.from(stateRaw, "base64url").toString("utf-8"));
      logInfo(logger, "[STEP 2/5] Decoded state", {
        openId: stateData.openId,
        accountId: stateData.accountId,
        noncePrefix: stateData.nonce?.slice(0, 8) + "...",
      });
    } catch (decodeErr) {
      logError(logger, "[STEP 2/5] State decode failed", decodeErr);
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(errorHtml("Invalid state parameter"));
      return;
    }

    // Validate and consume nonce (CSRF protection). File-persisted so it works after restart / multi-instance.
    const consumed = consumePendingNonce(config, stateData.nonce);
    if (!consumed) {
      const filePath = getNonceFilePath(config);
      const map = loadPendingNonces(filePath);
      logError(logger, "[STEP 3/5] Invalid or expired nonce", {
        openId: stateData.openId,
        noncePrefix: stateData.nonce?.slice(0, 8) + "...",
        pendingNoncesCount: map.size,
        nonceFilePath: filePath,
        hint: "Process may have restarted before callback, or request is older than 10 minutes. Nonces are now file-persisted to avoid this.",
      });
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(errorHtml("Invalid or expired authorization request. Please try again."));
      return;
    }

    // Use consumed openId/accountId (must match state for sanity)
    if (consumed.openId !== stateData.openId || consumed.accountId !== stateData.accountId) {
      logError(logger, "[STEP 3/5] State mismatch after consume", {
        consumedOpenId: consumed.openId,
        stateOpenId: stateData.openId,
        consumedAccountId: consumed.accountId,
        stateAccountId: stateData.accountId,
      });
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(errorHtml("State mismatch. Please try again."));
      return;
    }

    // Exchange code for token
    const protocol =
      config.callbackProtocol ??
      (host === "localhost" || host === "127.0.0.1" ? "http" : "https");
    const redirectUri = `${protocol}://${host}:${port}${callbackPath}`;
    const baseUrl = resolveApiBaseUrl(account.domain);

    logInfo(logger, "[STEP 4/5] Exchanging code for token", {
      redirectUri,
      tokenUrl: `${baseUrl}/open-apis/authen/v2/oauth/token`,
      openId: stateData.openId,
    });

    try {
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

      logInfo(logger, "[STEP 4/5] Token API response", {
        httpStatus: tokenResponse.status,
        code: tokenResult.code,
        msg: tokenResult.msg,
        hasAccessToken: Boolean(tokenResult.access_token),
        hasRefreshToken: Boolean(tokenResult.refresh_token),
        expiresIn: tokenResult.expires_in,
      });

      if (tokenResult.code !== 0 || !tokenResult.access_token) {
        logError(logger, "[STEP 4/5] Token exchange failed", {
          openId: stateData.openId,
          code: tokenResult.code,
          msg: tokenResult.msg ?? "unknown",
        });
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

      logInfo(logger, "[STEP 5/5] Token stored", {
        openId: stateData.openId,
        tokenStorePath: userTokenStore.getFilePath(),
        expiresAt: new Date(tokenInfo.expires_at).toISOString(),
        hasRefreshToken: Boolean(tokenInfo.refresh_token),
      });

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(successHtml());
    } catch (err) {
      logError(logger, "[STEP 4/5] Token exchange exception", err);
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      res.end(errorHtml("Internal server error during token exchange"));
    }
  });

  const listenHost = host === "localhost" ? "127.0.0.1" : "0.0.0.0";
  const protocol =
    config.callbackProtocol ??
    (host === "localhost" || host === "127.0.0.1" ? "http" : "https");
  const redirectUri = `${protocol}://${host}${port === 80 || port === 443 ? "" : `:${port}`}${callbackPath}`;

  server.listen(port, listenHost, () => {
    logInfo(logger, "Callback server started", {
      listenHost,
      port,
      callbackPath,
      redirectUri,
      hint: "Ensure this redirect_uri is whitelisted in Feishu Open Platform (OAuth redirect URL)",
    });
  });

  server.on("error", (err) => {
    logError(logger, "Callback server error (e.g. port in use, permission denied)", err);
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
