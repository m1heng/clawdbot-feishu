import { describe, expect, it } from "vitest";
import { feishuPlugin } from "../channel.js";

describe("channel account config contract", () => {
  it("Given mixed-case configured account key, When disabling the account, Then preserves the original config key", () => {
    const cfg = {
      channels: {
        feishu: {
          accounts: {
            TeamA: {
              appId: "id",
              appSecret: "secret",
              enabled: true,
            },
          },
        },
      },
    } as any;

    const next = feishuPlugin.config.setAccountEnabled?.({
      cfg,
      accountId: "teama",
      enabled: false,
    }) as any;

    expect(next.channels.feishu.accounts.TeamA.enabled).toBe(false);
    expect(next.channels.feishu.accounts.teama).toBeUndefined();
  });

  it("Given mixed-case configured account key, When deleting the account, Then removes the original config key", () => {
    const cfg = {
      channels: {
        feishu: {
          accounts: {
            TeamA: {
              appId: "id",
              appSecret: "secret",
            },
          },
        },
      },
    } as any;

    const next = feishuPlugin.config.deleteAccount?.({
      cfg,
      accountId: "teama",
    }) as any;

    expect(next.channels.feishu.accounts).toBeUndefined();
  });

  it("Given mixed-case configured account key, When applying account config, Then updates the existing key instead of creating a shadow entry", () => {
    const cfg = {
      channels: {
        feishu: {
          accounts: {
            TeamA: {
              appId: "id",
              appSecret: "secret",
              enabled: false,
            },
          },
        },
      },
    } as any;

    const next = feishuPlugin.setup.applyAccountConfig?.({
      cfg,
      accountId: "teama",
      input: {} as any,
    }) as any;

    expect(next.channels.feishu.accounts.TeamA.enabled).toBe(true);
    expect(next.channels.feishu.accounts.teama).toBeUndefined();
  });
});
