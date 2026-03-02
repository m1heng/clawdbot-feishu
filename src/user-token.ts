import type { FeishuClientCredentials } from "./client.js";

const FEISHU_API_BASE = "https://open.feishu.cn/open-apis";

// Token 过期错误码
export const USER_TOKEN_EXPIRED_CODES = [99991663, 99991664, 99991665];

// 提前 5 分钟视为过期，避免边界时刻请求失败
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

// ============ Types ============

interface UserTokenEntry {
  userAccessToken: string;
  refreshToken?: string;
  expiresAt: number; // 过期时间戳(ms)
}

export interface StoreUserTokenParams {
  accountId?: string;
  userAccessToken: string;
  refreshToken?: string;
  /** token 有效期（秒），默认 6900 (~2小时) */
  expiresIn?: number;
}

export interface GetUserAccessTokenParams {
  accountId?: string;
  /** 应用凭证，用于获取 app_access_token 以调用 refresh 接口 */
  creds: FeishuClientCredentials;
}

export interface UserTokenResult {
  token: string;
  refreshed: boolean;
}

export class UserTokenExpiredError extends Error {
  public readonly tokenExpired = true;
  constructor(message?: string) {
    super(
      message ??
        "user_access_token 已过期且无法自动刷新，请提供新的 token（以 u- 开头）"
    );
    this.name = "UserTokenExpiredError";
  }
}

export class UserTokenNotFoundError extends Error {
  public readonly tokenNotFound = true;
  constructor(message?: string) {
    super(
      message ??
        "未找到 user_access_token，请先提供 token（以 u- 开头）"
    );
    this.name = "UserTokenNotFoundError";
  }
}

// ============ In-memory Store ============

const tokenStore = new Map<string, UserTokenEntry>();

function storeKey(accountId?: string): string {
  return accountId ?? "default";
}

// ============ Internal: get app_access_token ============

interface AppTokenCache {
  token: string;
  expiresAt: number;
}

const appTokenCache = new Map<string, AppTokenCache>();

/**
 * 获取 app_access_token（自建应用内部获取方式）。
 * 独立于 Lark.Client，直接调用 HTTP 接口。
 */
async function getAppAccessToken(creds: FeishuClientCredentials): Promise<string> {
  const { appId, appSecret, accountId = "default" } = creds;

  if (!appId || !appSecret) {
    throw new Error(
      `Feishu credentials not configured for account "${accountId}"`
    );
  }

  // 检查缓存
  const cached = appTokenCache.get(accountId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const res = await fetch(
    `${FEISHU_API_BASE}/auth/v3/app_access_token/internal`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    }
  );

  const data = await res.json();

  if (data.code !== 0) {
    throw new Error(
      `Failed to get app_access_token: ${data.msg || data.code}`
    );
  }

  const token: string = data.app_access_token;
  const expiresIn: number = data.expire ?? 7200;

  appTokenCache.set(accountId, {
    token,
    expiresAt: Date.now() + expiresIn * 1000 - EXPIRY_BUFFER_MS,
  });

  return token;
}

// ============ Internal: refresh user token ============

async function refreshUserToken(
  refreshToken: string,
  creds: FeishuClientCredentials
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}> {
  const appToken = await getAppAccessToken(creds);

  const res = await fetch(
    `${FEISHU_API_BASE}/authen/v1/oidc/refresh_access_token`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    }
  );

  const data = await res.json();

  if (data.code !== 0) {
    throw new UserTokenExpiredError(
      `refresh_token 已过期或无效（code: ${data.code}），请提供新的 user_access_token（以 u- 开头）`
    );
  }

  const info = data.data;
  return {
    accessToken: info.access_token,
    refreshToken: info.refresh_token,
    expiresIn: info.expires_in ?? 6900,
    refreshExpiresIn: info.refresh_expires_in ?? 2592000,
  };
}

// ============ Public API ============

/**
 * 存储 user_access_token（和可选的 refresh_token）到内存缓存。
 * 用户首次提供 token 时调用。
 */
export function storeUserToken(params: StoreUserTokenParams): void {
  const { accountId, userAccessToken, refreshToken, expiresIn = 6900 } = params;
  const key = storeKey(accountId);

  tokenStore.set(key, {
    userAccessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000 - EXPIRY_BUFFER_MS,
  });
}

/**
 * 获取有效的 user_access_token。
 *
 * 流程：
 * 1. 缓存中有 token 且未过期 → 直接返回
 * 2. 缓存中有 token 但已过期，有 refresh_token → 自动刷新
 * 3. 刷新失败或无 token → 抛出错误
 *
 * @throws {UserTokenNotFoundError} 缓存中无 token
 * @throws {UserTokenExpiredError} token 过期且无法刷新
 */
export async function getUserAccessToken(
  params: GetUserAccessTokenParams
): Promise<UserTokenResult> {
  const { accountId, creds } = params;
  const key = storeKey(accountId);
  const entry = tokenStore.get(key);

  // 无缓存
  if (!entry) {
    throw new UserTokenNotFoundError();
  }

  // 未过期，直接返回
  if (entry.expiresAt > Date.now()) {
    return { token: entry.userAccessToken, refreshed: false };
  }

  // 已过期但有 refresh_token，尝试刷新
  if (entry.refreshToken) {
    const result = await refreshUserToken(entry.refreshToken, creds);

    // 更新缓存（两个 token 都更新）
    tokenStore.set(key, {
      userAccessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: Date.now() + result.expiresIn * 1000 - EXPIRY_BUFFER_MS,
    });

    return { token: result.accessToken, refreshed: true };
  }

  // 已过期且无 refresh_token
  throw new UserTokenExpiredError();
}

/**
 * 检查错误码是否为 user_access_token 过期。
 * 供各工具在 API 调用失败时判断是否需要刷新。
 */
export function isUserTokenExpiredCode(code: number): boolean {
  return USER_TOKEN_EXPIRED_CODES.includes(code);
}

/**
 * 标记缓存中的 token 为已过期，强制下次调用时刷新。
 */
export function invalidateUserToken(accountId?: string): void {
  const key = storeKey(accountId);
  const entry = tokenStore.get(key);
  if (entry) {
    entry.expiresAt = 0;
  }
}

/**
 * 清除指定账号或所有账号的 user token 缓存。
 */
export function clearUserToken(accountId?: string): void {
  if (accountId !== undefined) {
    tokenStore.delete(storeKey(accountId));
  } else {
    tokenStore.clear();
  }
}

/**
 * 检查是否有指定账号的 user token（不论是否过期）。
 */
export function hasUserToken(accountId?: string): boolean {
  return tokenStore.has(storeKey(accountId));
}
