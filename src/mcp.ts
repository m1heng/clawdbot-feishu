import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";

type FeishuDomain = "feishu" | "lark";

const MCP_URL = "https://mcp.feishu.cn/mcp";

function domainBase(domain: FeishuDomain | undefined) {
  // Feishu CN vs Lark Intl token endpoints
  return domain === "lark" ? "https://open.larksuite.com" : "https://open.feishu.cn";
}

let cachedTAT: { token: string; expireAtMs: number } | null = null;

async function getTenantAccessTokenInternal(opts: {
  appId: string;
  appSecret: string;
  domain?: FeishuDomain;
}): Promise<string> {
  const now = Date.now();
  if (cachedTAT && cachedTAT.expireAtMs - now > 60_000) return cachedTAT.token;

  const url = `${domainBase(opts.domain)}/open-apis/auth/v3/tenant_access_token/internal/`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: opts.appId, app_secret: opts.appSecret }),
  });

  if (!res.ok) {
    throw new Error(`Feishu TAT fetch failed: HTTP ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as any;
  // { code, msg, tenant_access_token, expire }
  if (typeof data?.tenant_access_token !== "string") {
    throw new Error(`Feishu TAT fetch failed: ${JSON.stringify(data)}`);
  }

  const expireSec = typeof data?.expire === "number" ? data.expire : 3600;
  cachedTAT = { token: data.tenant_access_token, expireAtMs: now + expireSec * 1000 };
  return cachedTAT.token;
}

export function registerFeishuMcpTool(api: ClawdbotPluginApi) {
  api.registerTool(
    {
      name: "feishu_mcp",
      description:
        "Call Feishu/Lark remote MCP service (https://mcp.feishu.cn/mcp) via JSON-RPC 2.0. Supports initialize/tools/list/tools/call. Can auto-fetch TAT using channels.feishu.appId/appSecret.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          // Auth
          authType: {
            type: "string",
            enum: ["auto", "tat", "uat"],
            description:
              "Auth mode. auto: prefer token if provided; else fetch TAT from appId/appSecret (server-to-server). tat/uat: require token or (tat) can be auto-fetched if no token.",
            default: "auto",
          },
          token: {
            type: "string",
            description: "MCP credential. For tat: t-gxxxx... For uat: u-gxxxx...",
          },
          allowedTools: {
            oneOf: [
              { type: "string", description: "Comma-separated tool names" },
              { type: "array", items: { type: "string" }, description: "Tool name list" },
            ],
            description:
              "Optional. If omitted, the Feishu MCP server will not expose any tools (per spec).",
          },

          // JSON-RPC
          id: { type: "integer", description: "JSON-RPC id", default: 1 },
          method: {
            type: "string",
            enum: ["initialize", "tools/list", "tools/call"],
            description: "MCP method",
          },
          params: {
            type: "object",
            description:
              "Raw JSON-RPC params. For tools/call you can use (toolName + arguments) instead.",
          },

          // Convenience for tools/call
          toolName: {
            type: "string",
            description: "Convenience field for tools/call: params.name",
          },
          arguments: {
            type: "object",
            description: "Convenience field for tools/call: params.arguments",
          },
        },
        required: ["method"],
      },
      async execute(_id, input: any) {
        const cfg: any = api.runtime?.config;
        const feishuCfg: any = cfg?.channels?.feishu;

        const authType: "auto" | "tat" | "uat" = input?.authType ?? "auto";
        let token: string | undefined = typeof input?.token === "string" ? input.token : undefined;

        const domain: FeishuDomain | undefined = feishuCfg?.domain;

        // Resolve token
        if (!token) {
          if (authType === "uat") {
            throw new Error("feishu_mcp: authType=uat requires token");
          }
          // auto or tat -> attempt to fetch TAT using app credentials
          const appId = feishuCfg?.appId;
          const appSecret = feishuCfg?.appSecret;
          if (!appId || !appSecret) {
            throw new Error(
              "feishu_mcp: no token provided and channels.feishu.appId/appSecret not configured (needed to auto-fetch TAT)",
            );
          }
          token = await getTenantAccessTokenInternal({ appId, appSecret, domain });
        }

        const allowedToolsRaw = input?.allowedTools;
        const allowedTools = Array.isArray(allowedToolsRaw)
          ? allowedToolsRaw
              .map((x: any) => String(x).trim())
              .filter(Boolean)
              .join(",")
          : typeof allowedToolsRaw === "string"
            ? allowedToolsRaw
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
                .join(",")
            : undefined;

        const id = typeof input?.id === "number" ? input.id : 1;
        const method = input?.method as string;

        let params = input?.params;
        if (method === "tools/call") {
          const toolName = input?.toolName;
          const args = input?.arguments;
          if (toolName && !params) {
            params = { name: toolName, arguments: args ?? {} };
          }
        }

        const headers: Record<string, string> = {
          "content-type": "application/json",
        };
        if (token.startsWith("u-")) headers["X-Lark-MCP-UAT"] = token;
        else headers["X-Lark-MCP-TAT"] = token;
        if (allowedTools) headers["X-Lark-MCP-Allowed-Tools"] = allowedTools;

        const body = {
          jsonrpc: "2.0",
          id,
          method,
          ...(params ? { params } : {}),
        };

        const res = await fetch(MCP_URL, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });

        const text = await res.text();
        let json: any = null;
        try {
          json = JSON.parse(text);
        } catch {
          // keep raw
        }

        // Always return both raw + parsed (if any). Do not throw on HTTP 200 tool errors:
        // Feishu MCP may encode tool exec errors in result.isError.
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  http: { status: res.status, ok: res.ok },
                  request: { url: MCP_URL, body, headers: { ...headers, ...(token ? { token: "[redacted]" } : {}) } },
                  response: json ?? text,
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    },
    { optional: true },
  );
}
