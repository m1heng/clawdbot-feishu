import * as Lark from "@larksuiteoapi/node-sdk";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createFeishuClient } from "./client.js";
import { listEnabledFeishuAccounts } from "./accounts.js";
import { resolveToolsConfig } from "./tools-config.js";
import { userTokenStore, resolveApiBaseUrl } from "./user-token.js";
import { FeishuSearchSchema, type FeishuSearchParams } from "./search-schema.js";

// ============ Helpers ============

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    details: data,
  };
}

// ============ Doc URL Generation ============

function generateDocUrl(baseUrl: string, docsType: string, docsToken: string): string {
  switch (docsType) {
    case "doc":
      return `${baseUrl}/docs/${docsToken}`;
    case "docx":
      return `${baseUrl}/docx/${docsToken}`;
    case "sheet":
      return `${baseUrl}/sheets/${docsToken}`;
    case "bitable":
      return `${baseUrl}/base/${docsToken}`;
    case "file":
      return `${baseUrl}/file/${docsToken}`;
    default:
      return "";
  }
}

const OBJ_TYPE_MAP: Record<number, string> = {
  1: "doc",
  2: "sheet",
  3: "bitable",
  4: "mindnote",
  5: "file",
  6: "slide",
  7: "wiki",
  8: "docx",
  9: "folder",
  10: "catalog",
};

// ============ Search Functions ============

interface SearchResult {
  title: string;
  docs_type?: string;
  docs_token?: string;
  url?: string;
}

/**
 * Search documents using the user's access token.
 */
async function searchDocument(
  userAccessToken: string,
  keyword: string,
  count: number,
  client: Lark.Client,
  docBaseUrl: string,
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  let offset = 0;
  const pageSize = Math.min(count, 50);

  const resp = await client.request(
    {
      url: "open-apis/suite/docs-api/search/object",
      method: "POST",
      data: {
        search_key: keyword,
        count: pageSize,
        offset,
      },
    },
    Lark.withUserAccessToken(userAccessToken),
  );

  if (resp.code !== 0 || !Array.isArray(resp.data?.docs_entities)) {
    throw new Error(resp.msg || "Document search failed");
  }

  const entities = resp.data.docs_entities as Array<{
    title: string;
    docs_type: string;
    docs_token: string;
  }>;

  for (const item of entities) {
    results.push({
      title: item.title,
      docs_type: item.docs_type,
      docs_token: item.docs_token,
      url: generateDocUrl(docBaseUrl, item.docs_type, item.docs_token),
    });
    if (results.length >= count) break;
  }

  return results;
}

/**
 * Search wiki nodes using the user's access token.
 */
async function searchWiki(
  userAccessToken: string,
  query: string,
  count: number,
  client: Lark.Client,
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  const resp = await client.request(
    {
      url: "open-apis/wiki/v1/nodes/search",
      method: "POST",
      data: { query },
    },
    Lark.withUserAccessToken(userAccessToken),
  );

  if (resp.code !== 0 || !Array.isArray(resp.data?.items)) {
    throw new Error(resp.msg || "Wiki search failed");
  }

  const items = resp.data.items as Array<{
    title: string;
    url: string;
    obj_type: number;
    obj_token: string;
  }>;

  for (const item of items) {
    results.push({
      title: item.title,
      docs_type: OBJ_TYPE_MAP[item.obj_type] ?? `type_${item.obj_type}`,
      docs_token: item.obj_token,
      url: item.url,
    });
    if (results.length >= count) break;
  }

  return results;
}

// ============ Doc Base URL ============

function resolveDocBaseUrl(domain: string | undefined): string {
  if (domain === "lark") return "https://www.larksuite.com";
  if (domain === "feishu" || !domain) return "https://feishu.cn";
  // For custom domains, try to derive a doc base URL
  return domain.replace("open.", "").replace(/\/+$/, "");
}

// ============ Tool Registration ============

export function registerFeishuSearchTools(api: OpenClawPluginApi) {
  if (!api.config) {
    api.logger.debug?.("feishu_search: No config available, skipping");
    return;
  }

  const accounts = listEnabledFeishuAccounts(api.config);
  if (accounts.length === 0) {
    api.logger.debug?.("feishu_search: No Feishu accounts configured, skipping");
    return;
  }

  const firstAccount = accounts[0];
  const toolsCfg = resolveToolsConfig(firstAccount.config.tools);
  if (!toolsCfg.search) {
    api.logger.debug?.("feishu_search: search tool disabled in config");
    return;
  }

  const getClient = () => createFeishuClient(firstAccount);
  const docBaseUrl = resolveDocBaseUrl(firstAccount.domain);

  api.registerTool(
    {
      name: "feishu_search",
      label: "Feishu Search",
      description:
        "Search Feishu documents and wiki pages. Requires user OAuth authorization. " +
        "Use feishu_user_auth to authorize the user first if not yet authorized. " +
        "Actions: search (search documents/wiki by keyword). " +
        "Type: document/doc (documents), wiki (knowledge base), all (both, default).",
      parameters: FeishuSearchSchema,
      async execute(_toolCallId, params) {
        const p = params as FeishuSearchParams;
        try {
          const count = p.count ?? 20;
          const searchType = p.type === "doc" ? "document" : (p.type ?? "all");

          // Get user token
          const userAccessToken = await userTokenStore.getValidAccessToken(
            p.open_id,
            firstAccount.appId!,
            firstAccount.appSecret!,
            firstAccount.domain,
          );

          if (!userAccessToken) {
            return json({
              error:
                "User has not authorized yet. " +
                "Use feishu_user_auth with action: 'authorize' and the user's open_id to generate an OAuth URL.",
            });
          }

          const client = getClient();
          const results: SearchResult[] = [];
          const errors: string[] = [];

          // Run searches based on type
          const promises: Promise<SearchResult[]>[] = [];
          if (searchType === "document" || searchType === "all") {
            promises.push(
              searchDocument(userAccessToken, p.keyword, count, client, docBaseUrl).catch(
                (err) => {
                  errors.push(`Document search: ${err.message}`);
                  return [] as SearchResult[];
                },
              ),
            );
          }
          if (searchType === "wiki" || searchType === "all") {
            promises.push(
              searchWiki(userAccessToken, p.keyword, count, client).catch((err) => {
                errors.push(`Wiki search: ${err.message}`);
                return [] as SearchResult[];
              }),
            );
          }

          const settled = await Promise.all(promises);
          for (const items of settled) {
            results.push(...items);
          }

          return json({
            results: results.slice(0, count),
            total: results.length,
            ...(errors.length > 0 && { warnings: errors }),
          });
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    { name: "feishu_search" },
  );

  api.logger.info?.("feishu_search: Registered feishu_search tool");
}
