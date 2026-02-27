import { describe, expect, it } from "vitest";
import { registerFeishuBitableTools } from "../bitable-tools/index.js";
import { registerFeishuDocTools } from "../doc-tools/index.js";
import { registerFeishuDriveTools } from "../drive-tools/index.js";
import { registerFeishuPermTools } from "../perm-tools/index.js";
import { registerFeishuTaskTools } from "../task-tools/index.js";
import { registerFeishuWikiTools } from "../wiki-tools/index.js";

type RegisteredTool = {
  name: string;
  parameters: unknown;
};

const MULTI_ACTION_UNION_TOOLS = new Set([
  "feishu_doc",
  "feishu_wiki",
  "feishu_drive",
  "feishu_perm",
]);

function createToolCaptureApi() {
  const tools: RegisteredTool[] = [];
  const api = {
    config: {
      channels: {
        feishu: {
          enabled: true,
          appId: "cli_test",
          appSecret: "test_secret",
          tools: {
            doc: true,
            wiki: true,
            drive: true,
            perm: true,
            scopes: true,
            task: true,
          },
        },
      },
    },
    logger: {
      debug: () => undefined,
    },
    registerTool: (tool: { name: string; parameters: unknown }) => {
      tools.push({ name: tool.name, parameters: tool.parameters });
    },
    registerChannel: () => undefined,
    runtime: {},
  } as any;

  registerFeishuDocTools(api);
  registerFeishuWikiTools(api);
  registerFeishuDriveTools(api);
  registerFeishuPermTools(api);
  registerFeishuBitableTools(api);
  registerFeishuTaskTools(api);

  return tools;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function hasTopLevelKeyword(schema: unknown, keyword: "anyOf" | "oneOf" | "allOf"): boolean {
  const record = asRecord(schema);
  return record ? Array.isArray(record[keyword]) : false;
}

function collectKeywordPaths(schema: unknown, keyword: "allOf"): string[] {
  const found: string[] = [];

  const walk = (value: unknown, path: string) => {
    if (!value) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (typeof value !== "object") {
      return;
    }

    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const nextPath = `${path}.${key}`;
      if (key === keyword) {
        found.push(nextPath);
      }
      walk(entry, nextPath);
    }
  };

  walk(schema, "$");
  return found;
}

describe("tool schema compatibility guardrails", () => {
  it("Given registered feishu tools, When checking root schema, Then no tool uses top-level allOf", () => {
    const tools = createToolCaptureApi();
    expect(tools.length).toBeGreaterThan(0);

    const offenders = tools
      .filter((tool) => hasTopLevelKeyword(tool.parameters, "allOf"))
      .map((tool) => tool.name);

    expect(offenders).toEqual([]);
  });

  it("Given non-union tools, When checking root schema, Then root is object without top-level anyOf/oneOf/allOf", () => {
    const tools = createToolCaptureApi().filter((tool) => !MULTI_ACTION_UNION_TOOLS.has(tool.name));
    expect(tools.length).toBeGreaterThan(0);

    for (const tool of tools) {
      const schema = asRecord(tool.parameters);
      expect(schema, `${tool.name}: schema should be an object`).not.toBeNull();
      expect(schema?.type, `${tool.name}: top-level type`).toBe("object");
      expect(hasTopLevelKeyword(schema, "anyOf"), `${tool.name}: top-level anyOf`).toBe(false);
      expect(hasTopLevelKeyword(schema, "oneOf"), `${tool.name}: top-level oneOf`).toBe(false);
      expect(hasTopLevelKeyword(schema, "allOf"), `${tool.name}: top-level allOf`).toBe(false);
    }
  });

  it("Given task tools, When checking schema tree, Then allOf is absent at any depth", () => {
    const taskTools = createToolCaptureApi().filter(
      (tool) => tool.name.startsWith("feishu_task") || tool.name.startsWith("feishu_tasklist"),
    );
    expect(taskTools.length).toBeGreaterThan(0);

    for (const tool of taskTools) {
      const allOfPaths = collectKeywordPaths(tool.parameters, "allOf");
      expect(allOfPaths, `${tool.name}: allOf paths`).toEqual([]);
    }
  });
});
