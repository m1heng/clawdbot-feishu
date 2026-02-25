import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: [
        "src/accounts.ts",
        "src/policy.ts",
        "src/targets.ts",
        "src/mention.ts",
        "src/text/markdown-links.ts",
        "src/tools-config.ts",
        "src/config-schema.ts",
        "src/tools-common/tool-exec.ts",
      ],
      exclude: [
        "src/**/__tests__/**",
        "src/**/index.ts",
      ],
      thresholds: {
        statements: 65,
        branches: 55,
        functions: 65,
        lines: 65,
      },
    },
  },
});
