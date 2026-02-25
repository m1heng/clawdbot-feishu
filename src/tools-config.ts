import type { FeishuToolsConfig } from "./types.js";

/**
 * Default tool configuration.
 * - doc, wiki, drive, scopes, task, chat: enabled by default
 * - perm: disabled by default (sensitive operation)
 */
export const DEFAULT_TOOLS_CONFIG: Required<FeishuToolsConfig> = {
  doc: true,
  wiki: true,
  drive: true,
  perm: false,
  scopes: true,
  task: true,
  chat: true,
  urgent: true,
};

/**
 * Resolve tools config with defaults.
 * Only includes keys that are present in the input config or defaults.
 */
export function resolveToolsConfig(cfg?: FeishuToolsConfig): Required<FeishuToolsConfig> {
  const res = {} as Required<FeishuToolsConfig>;
  for (const key in DEFAULT_TOOLS_CONFIG) {
    res[key] = cfg?.[key] ?? DEFAULT_TOOLS_CONFIG[key];
  }
  return res;
}
