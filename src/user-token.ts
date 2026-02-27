import fs from "node:fs";
import path from "node:path";
import type { FeishuDomain } from "./types.js";
import { getAuthLogger } from "./feishu-auth-debug.js";

// ============ Types ============

export interface UserTokenInfo {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // timestamp ms
  scope?: string;
}

// ============ Domain Helpers ============

/**
 * Resolve the Feishu API base URL from the domain config value.
 */
export function resolveApiBaseUrl(domain: FeishuDomain | undefined): string {
  if (domain === "lark") return "https://open.larksuite.com";
  if (domain === "feishu" || !domain) return "https://open.feishu.cn";
  return domain.replace(/\/+$/, ""); // Custom URL for private deployment
}

/**
 * Resolve the Feishu OAuth authorize URL from the domain config value.
 */
export function resolveAuthorizeBaseUrl(domain: FeishuDomain | undefined): string {
  if (domain === "lark") return "https://open.larksuite.com";
  if (domain === "feishu" || !domain) return "https://open.feishu.cn";
  return domain.replace(/\/+$/, "");
}

// ============ Internal log helper ============

function log(level: "info" | "error", msg: string, detail?: Record<string, unknown>): void {
  const authLog = getAuthLogger();
  if (!authLog) return;
  if (level === "info") authLog.info(msg, detail);
  else authLog.error(msg, detail);
}

// ============ User Token Store ============

const DEFAULT_TOKEN_FILE = ".feishu-user-tokens.json";

/**
 * If the given path is an existing directory, append the default token filename.
 * This prevents EISDIR errors when the user configures a directory instead of a file.
 */
function resolveTokenFilePath(inputPath: string): string {
  const abs = path.resolve(inputPath);
  try {
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
      const resolved = path.join(abs, DEFAULT_TOKEN_FILE);
      log("info", "[TokenStore] resolveTokenFilePath: path is a directory, appending default filename", {
        input: abs,
        resolved,
      });
      return resolved;
    }
  } catch {
    // statSync can fail for broken symlinks etc. – fall through to return as-is
  }
  // Also handle cases where path looks like a directory (trailing slash) but doesn't exist yet
  if (abs.endsWith(path.sep) || abs.endsWith("/")) {
    return path.join(abs, DEFAULT_TOKEN_FILE);
  }
  // If the path has no extension and no filename-like component, treat it as a directory
  const basename = path.basename(abs);
  if (!basename.includes(".")) {
    // Could be a directory that doesn't exist yet – check if parent exists and is a directory
    const parent = path.dirname(abs);
    try {
      if (fs.existsSync(parent) && fs.statSync(parent).isDirectory()) {
        // The path itself doesn't have an extension – likely intended as a directory
        const resolved = path.join(abs, DEFAULT_TOKEN_FILE);
        log("info", "[TokenStore] resolveTokenFilePath: path has no extension, treating as directory", {
          input: abs,
          resolved,
        });
        return resolved;
      }
    } catch {
      // fall through
    }
  }
  return abs;
}

/**
 * File-persisted multi-user token store.
 * Keyed by open_id. Supports token refresh via Feishu OAuth v2.
 */
export class UserTokenStore {
  private tokens: Map<string, UserTokenInfo> = new Map();
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = resolveTokenFilePath(filePath ?? path.resolve(DEFAULT_TOKEN_FILE));
    this.load();
  }

  /**
   * Return the current token store file path (absolute).
   */
  getFilePath(): string {
    return path.resolve(this.filePath);
  }

  /**
   * Reinitialize the store to use a new file path (e.g. from config tokenStorePath).
   * Loads tokens from the new path; does not clear in-memory state until load() runs.
   */
  reinitialize(newFilePath: string): void {
    const oldPath = this.filePath;
    this.filePath = resolveTokenFilePath(path.resolve(newFilePath));
    log("info", "[TokenStore] reinitialize", {
      oldPath,
      newPath: this.filePath,
    });
    this.load();
  }

  /**
   * Load tokens from disk. Called once on construction and from reinitialize().
   */
  load(): void {
    const absPath = path.resolve(this.filePath);
    const fileExists = fs.existsSync(absPath);
    log("info", "[TokenStore] load", {
      filePath: absPath,
      fileExists,
    });

    if (!fileExists) {
      log("info", "[TokenStore] load: file not found, starting with empty store", { filePath: absPath });
      this.tokens = new Map();
      return;
    }

    try {
      const raw = fs.readFileSync(absPath, "utf-8");
      const data = JSON.parse(raw) as Record<string, UserTokenInfo>;
      const openIds = Object.keys(data);
      this.tokens = new Map(Object.entries(data));

      const now = Date.now();
      const summary = openIds.map((id) => {
        const info = data[id];
        const expired = info.expires_at <= now;
        return `${id}(${expired ? "EXPIRED" : "valid"}, expires=${new Date(info.expires_at).toISOString()})`;
      });

      log("info", "[TokenStore] load: loaded tokens", {
        filePath: absPath,
        tokenCount: openIds.length,
        tokens: summary.join(", "),
      });
    } catch (err) {
      log("error", "[TokenStore] load: failed to parse token file, starting fresh", {
        filePath: absPath,
        error: err instanceof Error ? err.message : String(err),
      });
      this.tokens = new Map();
    }
  }

  /**
   * Save tokens to disk (write-through on every mutation).
   */
  private save(): void {
    const absPath = path.resolve(this.filePath);
    try {
      const dir = path.dirname(absPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = Object.fromEntries(this.tokens);
      fs.writeFileSync(absPath, JSON.stringify(data, null, 2), "utf-8");
      log("info", "[TokenStore] save: written to disk", {
        filePath: absPath,
        tokenCount: this.tokens.size,
      });
    } catch (err) {
      log("error", "[TokenStore] save: failed to write", {
        filePath: absPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Get token info for a user. Returns null if missing or expired.
   * If not found in memory, reloads from disk (handles cross-context writes).
   */
  getToken(openId: string): UserTokenInfo | null {
    let info = this.tokens.get(openId);
    const now = Date.now();
    const needsReload = !info || info.expires_at <= now;

    // Reload from disk if token is missing OR expired — another context
    // (e.g. the OAuth callback server) may have saved a fresh token.
    if (needsReload) {
      log("info", "[TokenStore] getToken: reloading from disk (token missing or expired)", {
        openId,
        filePath: this.getFilePath(),
        reason: !info ? "not_in_memory" : "expired",
        memoryExpiresAt: info ? new Date(info.expires_at).toISOString() : null,
      });
      this.load();
      info = this.tokens.get(openId);
    }

    if (!info) {
      log("info", "[TokenStore] getToken: not found (even after disk reload)", {
        openId,
        filePath: this.getFilePath(),
        storedOpenIds: [...this.tokens.keys()].join(", ") || "(empty)",
      });
      return null;
    }

    if (info.expires_at <= Date.now()) {
      log("info", "[TokenStore] getToken: token expired (even after disk reload)", {
        openId,
        expiredAt: new Date(info.expires_at).toISOString(),
        expiredAgoMs: Date.now() - info.expires_at,
      });
      return null;
    }

    log("info", "[TokenStore] getToken: found valid token", {
      openId,
      expiresAt: new Date(info.expires_at).toISOString(),
      remainingMs: info.expires_at - Date.now(),
    });
    return info;
  }

  /**
   * Store token info for a user (persists to disk).
   */
  setToken(openId: string, info: UserTokenInfo): void {
    log("info", "[TokenStore] setToken", {
      openId,
      filePath: this.getFilePath(),
      expiresAt: new Date(info.expires_at).toISOString(),
      hasRefreshToken: Boolean(info.refresh_token),
    });
    this.tokens.set(openId, info);
    this.save();
  }

  /**
   * Remove a user's token (persists to disk).
   */
  removeToken(openId: string): void {
    log("info", "[TokenStore] removeToken", {
      openId,
      filePath: this.getFilePath(),
      existed: this.tokens.has(openId),
    });
    this.tokens.delete(openId);
    this.save();
  }

  /**
   * Check if a user has a non-expired token.
   */
  hasValidToken(openId: string): boolean {
    return this.getToken(openId) !== null;
  }

  /**
   * Try to refresh a user's token using the stored refresh_token.
   * Returns the new token info or null if refresh fails.
   */
  async refreshToken(
    openId: string,
    appId: string,
    appSecret: string,
    domain: FeishuDomain | undefined,
  ): Promise<UserTokenInfo | null> {
    const existing = this.tokens.get(openId);
    if (!existing?.refresh_token) {
      log("info", "[TokenStore] refreshToken: no refresh_token available", { openId });
      return null;
    }

    const baseUrl = resolveApiBaseUrl(domain);
    log("info", "[TokenStore] refreshToken: attempting refresh", {
      openId,
      tokenUrl: `${baseUrl}/open-apis/authen/v2/oauth/token`,
    });

    try {
      const response = await fetch(`${baseUrl}/open-apis/authen/v2/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          client_id: appId,
          client_secret: appSecret,
          refresh_token: existing.refresh_token,
        }),
      });

      const result = (await response.json()) as {
        code?: number;
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
      };

      if (result.code !== 0 || !result.access_token) {
        log("error", "[TokenStore] refreshToken: refresh failed, removing token", {
          openId,
          code: result.code,
        });
        this.removeToken(openId);
        return null;
      }

      const newInfo: UserTokenInfo = {
        access_token: result.access_token,
        refresh_token: result.refresh_token ?? existing.refresh_token,
        expires_at: Date.now() + (result.expires_in ?? 6900) * 1000,
        scope: result.scope ?? existing.scope,
      };

      log("info", "[TokenStore] refreshToken: success", {
        openId,
        expiresAt: new Date(newInfo.expires_at).toISOString(),
      });
      this.setToken(openId, newInfo);
      return newInfo;
    } catch (err) {
      log("error", "[TokenStore] refreshToken: exception", {
        openId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * Get a valid access token for a user.
   * Checks expiry, tries refresh if needed, returns null if both fail.
   * This is the main entry point for tools that need a user token.
   */
  async getValidAccessToken(
    openId: string,
    appId: string,
    appSecret: string,
    domain: FeishuDomain | undefined,
  ): Promise<string | null> {
    log("info", "[TokenStore] getValidAccessToken: start", {
      openId,
      filePath: this.getFilePath(),
      storedOpenIds: [...this.tokens.keys()].join(", ") || "(empty)",
      tokenCount: this.tokens.size,
    });

    // Check if current token is still valid (with 5-minute buffer)
    let info = this.tokens.get(openId);
    const needsRefresh = !info || info.expires_at <= Date.now() + 5 * 60 * 1000;

    // Reload from disk if token is missing OR expired/expiring — another context
    // (e.g. the OAuth callback server) may have saved a fresh token to disk.
    if (needsRefresh) {
      log("info", "[TokenStore] getValidAccessToken: reloading from disk (token missing or expired)", {
        openId,
        filePath: this.getFilePath(),
        reason: !info ? "not_in_memory" : "expired_or_expiring",
        memoryExpiresAt: info ? new Date(info.expires_at).toISOString() : null,
      });
      this.load();
      info = this.tokens.get(openId);
    }

    if (info && info.expires_at > Date.now() + 5 * 60 * 1000) {
      log("info", "[TokenStore] getValidAccessToken: token valid, returning", {
        openId,
        expiresAt: new Date(info.expires_at).toISOString(),
        remainingMinutes: Math.round((info.expires_at - Date.now()) / 60000),
      });
      return info.access_token;
    }

    if (info) {
      log("info", "[TokenStore] getValidAccessToken: token expired or expiring soon (even after disk reload)", {
        openId,
        expiresAt: new Date(info.expires_at).toISOString(),
        hasRefreshToken: Boolean(info.refresh_token),
      });
    } else {
      log("info", "[TokenStore] getValidAccessToken: no token found (even after disk reload)", {
        openId,
        storedOpenIds: [...this.tokens.keys()].join(", ") || "(empty)",
      });
    }

    // Try refresh
    if (info?.refresh_token) {
      const refreshed = await this.refreshToken(openId, appId, appSecret, domain);
      if (refreshed) return refreshed.access_token;
    }

    log("info", "[TokenStore] getValidAccessToken: returning null (no valid token)", { openId });
    return null;
  }
}

/**
 * Singleton user token store instance.
 */
export const userTokenStore = new UserTokenStore();
