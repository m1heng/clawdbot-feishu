import { describe, expect, it } from "vitest";
import { DEFAULT_TOOLS_CONFIG, resolveToolsConfig } from "../tools-config.js";

describe("tools-config", () => {
  it("uses secure defaults", () => {
    expect(DEFAULT_TOOLS_CONFIG).toEqual({
      doc: true,
      wiki: true,
      drive: true,
      perm: false,
      scopes: true,
      task: true,
    });
  });

  it("merges custom toggles with defaults", () => {
    expect(resolveToolsConfig({ perm: true, task: false })).toEqual({
      doc: true,
      wiki: true,
      drive: true,
      perm: true,
      scopes: true,
      task: false,
    });
  });
});
