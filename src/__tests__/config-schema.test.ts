import { describe, expect, it } from "vitest";
import { FeishuAccountConfigSchema, FeishuConfigSchema } from "../config-schema.js";

describe("config-schema contract", () => {
  it("Given empty config, When parsing, Then default values are injected", () => {
    const parsed = FeishuConfigSchema.parse({});
    expect(parsed.domain).toBe("feishu");
    expect(parsed.connectionMode).toBe("websocket");
    expect(parsed.dmPolicy).toBe("pairing");
    expect(parsed.groupPolicy).toBe("allowlist");
    expect(parsed.requireMention).toBe(true);
    expect(parsed.groupCommandMentionBypass).toBe("single_bot");
    expect(parsed.webhookPath).toBe("/feishu/events");
  });

  it('Given dmPolicy="open" without wildcard, When parsing, Then returns a custom issue on allowFrom', () => {
    const result = FeishuConfigSchema.safeParse({
      dmPolicy: "open",
      allowFrom: ["ou_user"],
    });
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected parsing to fail");
    }
    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["allowFrom"],
          message:
            'channels.feishu.dmPolicy="open" requires channels.feishu.allowFrom to include "*"',
        }),
      ]),
    );

    expect(
      FeishuConfigSchema.parse({
        dmPolicy: "open",
        allowFrom: ["*", "ou_user"],
      }).dmPolicy,
    ).toBe("open");
  });

  it("Given unknown keys, When parsing strict schemas, Then rejects with validation errors", () => {
    expect(() =>
      FeishuConfigSchema.parse({
        unknownField: true,
      } as any),
    ).toThrow();

    expect(() =>
      FeishuAccountConfigSchema.parse({
        anotherUnknownField: "x",
      } as any),
    ).toThrow();
  });

  it("Given account-level config, When parsing, Then nested account config is preserved", () => {
    const parsed = FeishuConfigSchema.parse({
      accounts: {
        teamA: {
          appId: "cli_x",
          appSecret: "secret_x",
          tools: {
            doc: false,
            task: true,
          },
        },
      },
    });

    expect(parsed.accounts?.teamA?.appId).toBe("cli_x");
    expect(parsed.accounts?.teamA?.tools?.doc).toBe(false);
    expect(parsed.accounts?.teamA?.tools?.task).toBe(true);
  });
});
