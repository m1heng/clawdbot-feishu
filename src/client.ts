import * as Lark from "@larksuiteoapi/node-sdk";
import { HttpsProxyAgent } from "https-proxy-agent";
import type { FeishuDomain, ResolvedFeishuAccount } from "./types.js";

type ProxyCarrier = {
  proxy?: string;
  config?: { proxy?: string };
};

type ResolvedProxy = {
  proxyUrl?: string;
  agent?: HttpsProxyAgent<string>;
  invalidProxy?: string;
};

function normalizeProxyUrl(rawProxy?: string): string | undefined {
  const proxy = rawProxy?.trim();
  return proxy ? proxy : undefined;
}

function resolveProxy(rawProxy?: string): ResolvedProxy {
  const proxyUrl = normalizeProxyUrl(rawProxy);
  if (!proxyUrl) {
    return {};
  }

  try {
    const parsed = new URL(proxyUrl);
    return {
      proxyUrl: parsed.toString(),
      agent: new HttpsProxyAgent(parsed.toString()),
    };
  } catch {
    return { invalidProxy: proxyUrl };
  }
}

function warnInvalidProxy(accountId: string, invalidProxy: string): void {
  const preview = invalidProxy.length > 64 ? `${invalidProxy.slice(0, 64)}...` : invalidProxy;
  console.warn(
    `feishu[${accountId}]: invalid proxy URL in channels.feishu.proxy (${preview}), falling back to direct connection`,
  );
}

function resolveConfiguredProxy(creds: FeishuClientCredentials): string | undefined {
  const carrier = creds as ProxyCarrier;
  return normalizeProxyUrl(carrier.proxy ?? carrier.config?.proxy);
}

function createHttpInstance(proxy: ResolvedProxy): { request: (options: unknown) => Promise<unknown> } {
  return {
    request: (options: unknown) => {
      const requestOptions = {
        ...(options as Record<string, unknown>),
        proxy: false,
        ...(proxy.agent ? { httpAgent: proxy.agent, httpsAgent: proxy.agent } : {}),
      };
      return (Lark.defaultHttpInstance as { request: (params: unknown) => Promise<unknown> }).request(
        requestOptions,
      );
    },
  };
}

// Multi-account client cache
const clientCache = new Map<
  string,
  {
    client: Lark.Client;
    config: { appId: string; appSecret: string; domain?: FeishuDomain; proxy?: string };
  }
>();

function resolveDomain(domain: FeishuDomain | undefined): Lark.Domain | string {
  if (domain === "lark") return Lark.Domain.Lark;
  if (domain === "feishu" || !domain) return Lark.Domain.Feishu;
  return domain.replace(/\/+$/, ""); // Custom URL for private deployment
}

/**
 * Credentials needed to create a Feishu client.
 * Both FeishuConfig and ResolvedFeishuAccount satisfy this interface.
 */
export type FeishuClientCredentials = {
  accountId?: string;
  appId?: string;
  appSecret?: string;
  domain?: FeishuDomain;
  proxy?: string;
};

/**
 * Create or get a cached Feishu client for an account.
 * Accepts any object with appId, appSecret, and optional domain/accountId.
 */
export function createFeishuClient(creds: FeishuClientCredentials): Lark.Client {
  const { accountId = "default", appId, appSecret, domain } = creds;
  const configuredProxy = resolveConfiguredProxy(creds);
  const resolvedProxy = resolveProxy(configuredProxy);
  if (resolvedProxy.invalidProxy) {
    warnInvalidProxy(accountId, resolvedProxy.invalidProxy);
  }

  if (!appId || !appSecret) {
    throw new Error(`Feishu credentials not configured for account "${accountId}"`);
  }

  // Check cache
  const cached = clientCache.get(accountId);
  if (
    cached &&
    cached.config.appId === appId &&
    cached.config.appSecret === appSecret &&
    cached.config.domain === domain &&
    cached.config.proxy === resolvedProxy.proxyUrl
  ) {
    return cached.client;
  }

  // Create new client
  const client = new Lark.Client({
    appId,
    appSecret,
    appType: Lark.AppType.SelfBuild,
    domain: resolveDomain(domain),
    httpInstance: createHttpInstance(resolvedProxy),
  });

  // Cache it
  clientCache.set(accountId, {
    client,
    config: { appId, appSecret, domain, proxy: resolvedProxy.proxyUrl },
  });

  return client;
}

/**
 * Create a Feishu WebSocket client for an account.
 * Note: WSClient is not cached since each call creates a new connection.
 */
export function createFeishuWSClient(account: ResolvedFeishuAccount): Lark.WSClient {
  const { accountId, appId, appSecret, domain } = account;
  const resolvedProxy = resolveProxy(account.config.proxy);
  if (resolvedProxy.invalidProxy) {
    warnInvalidProxy(accountId, resolvedProxy.invalidProxy);
  }

  if (!appId || !appSecret) {
    throw new Error(`Feishu credentials not configured for account "${accountId}"`);
  }

  return new Lark.WSClient({
    appId,
    appSecret,
    domain: resolveDomain(domain),
    loggerLevel: Lark.LoggerLevel.info,
    httpInstance: createHttpInstance(resolvedProxy),
    ...(resolvedProxy.agent ? { agent: resolvedProxy.agent } : {}),
  });
}

/**
 * Create an event dispatcher for an account.
 */
export function createEventDispatcher(account: ResolvedFeishuAccount): Lark.EventDispatcher {
  return new Lark.EventDispatcher({
    encryptKey: account.encryptKey,
    verificationToken: account.verificationToken,
  });
}

/**
 * Get a cached client for an account (if exists).
 */
export function getFeishuClient(accountId: string): Lark.Client | null {
  return clientCache.get(accountId)?.client ?? null;
}

/**
 * Clear client cache for a specific account or all accounts.
 */
export function clearClientCache(accountId?: string): void {
  if (accountId) {
    clientCache.delete(accountId);
  } else {
    clientCache.clear();
  }
}
