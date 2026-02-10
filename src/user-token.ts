import fs from "node:fs";
import path from "node:path";
import type { FeishuDomain } from "./types.js";

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

// ============ User Token Store ============

const DEFAULT_TOKEN_FILE = ".feishu-user-tokens.json";

/**
 * File-persisted multi-user token store.
 * Keyed by open_id. Supports token refresh via Feishu OAuth v2.
 */
export class UserTokenStore {
  private tokens: Map<string, UserTokenInfo> = new Map();
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? path.resolve(DEFAULT_TOKEN_FILE);
    this.load();
  }

  /**
   * Load tokens from disk. Called once on construction.
   */
  load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        const data = JSON.parse(raw) as Record<string, UserTokenInfo>;
        this.tokens = new Map(Object.entries(data));
      }
    } catch {
      // If file is corrupt or unreadable, start fresh
      this.tokens = new Map();
    }
  }

  /**
   * Save tokens to disk (write-through on every mutation).
   */
  private save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = Object.fromEntries(this.tokens);
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch {
      // Silent failure on save - token will still be in memory
    }
  }

  /**
   * Get token info for a user. Returns null if missing or expired.
   */
  getToken(openId: string): UserTokenInfo | null {
    const info = this.tokens.get(openId);
    if (!info) return null;
    if (info.expires_at <= Date.now()) return null;
    return info;
  }

  /**
   * Store token info for a user (persists to disk).
   */
  setToken(openId: string, info: UserTokenInfo): void {
    this.tokens.set(openId, info);
    this.save();
  }

  /**
   * Remove a user's token (persists to disk).
   */
  removeToken(openId: string): void {
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
    if (!existing?.refresh_token) return null;

    const baseUrl = resolveApiBaseUrl(domain);

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
        // Refresh failed - remove invalid token
        this.removeToken(openId);
        return null;
      }

      const newInfo: UserTokenInfo = {
        access_token: result.access_token,
        refresh_token: result.refresh_token ?? existing.refresh_token,
        expires_at: Date.now() + (result.expires_in ?? 6900) * 1000,
        scope: result.scope ?? existing.scope,
      };

      this.setToken(openId, newInfo);
      return newInfo;
    } catch {
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
    // Check if current token is still valid (with 5-minute buffer)
    const info = this.tokens.get(openId);
    if (info && info.expires_at > Date.now() + 5 * 60 * 1000) {
      return info.access_token;
    }

    // Try refresh
    if (info?.refresh_token) {
      const refreshed = await this.refreshToken(openId, appId, appSecret, domain);
      if (refreshed) return refreshed.access_token;
    }

    return null;
  }
}

/**
 * Singleton user token store instance.
 */
export const userTokenStore = new UserTokenStore();
