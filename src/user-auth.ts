import http from "node:http";
import crypto from "node:crypto";
import { userTokenStore, resolveApiBaseUrl, resolveAuthorizeBaseUrl, type UserTokenInfo } from "./user-token.js";
import type { ResolvedFeishuAccount } from "./types.js";

// ============ Types ============

export interface UserAuthConfig {
  enabled?: boolean;
  callbackPort?: number; // default: 16688
  callbackHost?: string; // default: localhost — used in redirect_uri (the public-facing hostname)
  /** Actual address the HTTP server binds to. Default: "127.0.0.1" if callbackHost is localhost, otherwise "0.0.0.0". Set to "127.0.0.1" to restrict to loopback only even with a public callbackHost (use a reverse proxy). */
  callbackListenHost?: string;
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

// ============ HMAC-Signed State (stateless, no file I/O) ============

/** State expiry time: 10 minutes */
const STATE_TTL_MS = 10 * 60 * 1000;

/** Payload embedded in the OAuth state parameter. */
interface StatePayload {
  openId: string;
  accountId: string;
  ts: number; // Date.now() when created
}

/**
 * Create an HMAC-SHA256 hex signature over the payload.
 */
function signState(payload: StatePayload, secret: string): string {
  const data = JSON.stringify({ openId: payload.openId, accountId: payload.accountId, ts: payload.ts });
  return crypto.createHmac("sha256", secret).update(data).digest("hex");
}

/**
 * Build a signed state string (base64url-encoded JSON with HMAC signature).
 */
function buildSignedState(openId: string, accountId: string, secret: string): string {
  const payload: StatePayload = { openId, accountId, ts: Date.now() };
  const sig = signState(payload, secret);
  return Buffer.from(JSON.stringify({ ...payload, sig })).toString("base64url");
}

/**
 * Verify a signed state string. Returns the payload if valid, null otherwise.
 * Checks: JSON parseable, HMAC signature matches, timestamp within TTL.
 */
function verifyState(
  stateRaw: string,
  secret: string,
  logger?: UserAuthLogger,
): { openId: string; accountId: string } | null {
  let parsed: StatePayload & { sig?: string };
  try {
    parsed = JSON.parse(Buffer.from(stateRaw, "base64url").toString("utf-8"));
  } catch (err) {
    logError(logger, "[State] Failed to decode state", err);
    return null;
  }

  if (!parsed.openId || !parsed.accountId || !parsed.ts || !parsed.sig) {
    logError(logger, "[State] Missing required fields in state", {
      hasOpenId: Boolean(parsed.openId),
      hasAccountId: Boolean(parsed.accountId),
      hasTs: Boolean(parsed.ts),
      hasSig: Boolean(parsed.sig),
    });
    return null;
  }

  // Verify HMAC signature
  const payload: StatePayload = { openId: parsed.openId, accountId: parsed.accountId, ts: parsed.ts };
  const expectedSig = signState(payload, secret);
  const sigValid = crypto.timingSafeEqual(
    Buffer.from(parsed.sig, "hex"),
    Buffer.from(expectedSig, "hex"),
  );

  if (!sigValid) {
    logError(logger, "[State] HMAC signature mismatch — state was tampered or signed with a different secret", {
      openId: parsed.openId,
    });
    return null;
  }

  // Check timestamp
  const age = Date.now() - parsed.ts;
  if (age > STATE_TTL_MS) {
    logError(logger, "[State] State expired", {
      openId: parsed.openId,
      createdAt: new Date(parsed.ts).toISOString(),
      ageMs: age,
      ttlMs: STATE_TTL_MS,
    });
    return null;
  }

  if (age < 0) {
    logError(logger, "[State] State timestamp is in the future — clock skew?", {
      openId: parsed.openId,
      ts: parsed.ts,
      now: Date.now(),
    });
    return null;
  }

  logInfo(logger, "[State] Verified OK", {
    openId: parsed.openId,
    accountId: parsed.accountId,
    ageSeconds: Math.round(age / 1000),
  });
  return { openId: parsed.openId, accountId: parsed.accountId };
}

// ============ OAuth URL Builder ============

/**
 * Build the OAuth authorize URL for a user.
 * The state parameter is HMAC-signed (stateless, no file I/O).
 */
export function buildAuthorizeUrl(
  openId: string,
  account: ResolvedFeishuAccount,
  config: UserAuthConfig,
  logger?: UserAuthLogger,
): string {
  const host = config.callbackHost ?? DEFAULT_CALLBACK_HOST;
  const port = config.callbackPort ?? DEFAULT_CALLBACK_PORT;
  const callbackPath = config.callbackPath ?? DEFAULT_CALLBACK_PATH;
  const scopes = config.scopes ?? DEFAULT_SCOPES;

  // Build redirect_uri: use callbackProtocol if set, else http for localhost only
  const protocol =
    config.callbackProtocol ??
    (host === "localhost" || host === "127.0.0.1" ? "http" : "https");
  const redirectUri = `${protocol}://${host}:${port}${callbackPath}`;

  // Build HMAC-signed state (no file I/O needed)
  const state = buildSignedState(openId, account.accountId, account.appSecret!);

  logInfo(logger, "[Auth] Built authorize URL", {
    openId,
    redirectUri,
    stateLength: state.length,
  });

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
 * State verification is stateless (HMAC signature), no file I/O needed.
 */
export function startAuthCallbackServer(
  account: ResolvedFeishuAccount,
  config: UserAuthConfig,
  logger?: { info?: (...args: any[]) => void; error?: (...args: any[]) => void },
): http.Server {
  // If a previous server instance exists, close it first to avoid EADDRINUSE
  if (callbackServer) {
    logInfo(logger, "Closing existing callback server before restarting");
    try { callbackServer.close(); } catch { /* ignore */ }
    callbackServer = null;
  }

  const port = config.callbackPort ?? DEFAULT_CALLBACK_PORT;
  const callbackPath = config.callbackPath ?? DEFAULT_CALLBACK_PATH;
  const host = config.callbackHost ?? DEFAULT_CALLBACK_HOST;
  const appSecret = account.appSecret!;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    logInfo(logger, "[STEP 1/4] Received callback request", {
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

    logInfo(logger, "[STEP 1/4] Callback query params", {
      hasCode: Boolean(code),
      codeLength: code?.length ?? 0,
      hasState: Boolean(stateRaw),
      stateLength: stateRaw?.length ?? 0,
    });

    if (!code || !stateRaw) {
      logError(logger, "[STEP 1/4] Missing code or state in callback");
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(errorHtml("Missing code or state parameter"));
      return;
    }

    // Verify HMAC-signed state (stateless — no file I/O)
    const verified = verifyState(stateRaw, appSecret, logger);
    if (!verified) {
      logError(logger, "[STEP 2/4] State verification failed — see [State] logs above for details");
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(errorHtml("Invalid or expired authorization request. Please try again."));
      return;
    }

    logInfo(logger, "[STEP 2/4] State verified", {
      openId: verified.openId,
      accountId: verified.accountId,
    });

    // Exchange code for token
    const protocol =
      config.callbackProtocol ??
      (host === "localhost" || host === "127.0.0.1" ? "http" : "https");
    const redirectUri = `${protocol}://${host}:${port}${callbackPath}`;
    const baseUrl = resolveApiBaseUrl(account.domain);

    logInfo(logger, "[STEP 3/4] Exchanging code for token", {
      redirectUri,
      tokenUrl: `${baseUrl}/open-apis/authen/v2/oauth/token`,
      openId: verified.openId,
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

      logInfo(logger, "[STEP 3/4] Token API response", {
        httpStatus: tokenResponse.status,
        code: tokenResult.code,
        msg: tokenResult.msg,
        hasAccessToken: Boolean(tokenResult.access_token),
        hasRefreshToken: Boolean(tokenResult.refresh_token),
        expiresIn: tokenResult.expires_in,
      });

      if (tokenResult.code !== 0 || !tokenResult.access_token) {
        logError(logger, "[STEP 3/4] Token exchange failed", {
          openId: verified.openId,
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

      userTokenStore.setToken(verified.openId, tokenInfo);

      logInfo(logger, "[STEP 4/4] Token stored", {
        openId: verified.openId,
        tokenStorePath: userTokenStore.getFilePath(),
        expiresAt: new Date(tokenInfo.expires_at).toISOString(),
        hasRefreshToken: Boolean(tokenInfo.refresh_token),
      });

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(successHtml());
    } catch (err) {
      logError(logger, "[STEP 3/4] Token exchange exception", err);
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      res.end(errorHtml("Internal server error during token exchange"));
    }
  });

  const listenHost = config.callbackListenHost ?? (host === "localhost" ? "127.0.0.1" : "0.0.0.0");
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
