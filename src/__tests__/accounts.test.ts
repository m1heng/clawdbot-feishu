import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import { describe, expect, it } from "vitest";
import {
  listEnabledFeishuAccounts,
  listFeishuAccountIds,
  resolveDefaultFeishuAccountId,
  resolveFeishuAccount,
  resolveFeishuCredentials,
} from "../accounts.js";

describe("accounts contract", () => {
  describe("listFeishuAccountIds", () => {
    it("Given single-account mode, When accounts map is absent, Then returns default account id", () => {
      const cfg = { channels: { feishu: {} } } as any;
      expect(listFeishuAccountIds(cfg)).toEqual([DEFAULT_ACCOUNT_ID]);
    });

    it("Given multi-account config, When listing ids, Then returns sorted account ids", () => {
      const cfg = {
        channels: {
          feishu: {
            accounts: {
              beta: {},
              alpha: {},
            },
          },
        },
      } as any;
      expect(listFeishuAccountIds(cfg)).toEqual(["alpha", "beta"]);
    });
  });

  describe("resolveDefaultFeishuAccountId", () => {
    it("Given default id exists, When resolving default, Then prefer DEFAULT_ACCOUNT_ID", () => {
      const cfgWithDefault = {
        channels: {
          feishu: {
            accounts: {
              [DEFAULT_ACCOUNT_ID]: {},
              beta: {},
            },
          },
        },
      } as any;
      expect(resolveDefaultFeishuAccountId(cfgWithDefault)).toBe(DEFAULT_ACCOUNT_ID);

      const cfgWithoutDefault = {
        channels: {
          feishu: {
            accounts: {
              beta: {},
              alpha: {},
            },
          },
        },
      } as any;
      expect(resolveDefaultFeishuAccountId(cfgWithoutDefault)).toBe("alpha");
    });
  });

  describe("resolveFeishuCredentials", () => {
    it("Given raw credentials with spaces, When resolving, Then trims and injects domain default", () => {
      expect(
        resolveFeishuCredentials({
          appId: " app-id ",
          appSecret: " app-secret ",
        } as any),
      ).toEqual({
        appId: "app-id",
        appSecret: "app-secret",
        encryptKey: undefined,
        verificationToken: undefined,
        domain: "feishu",
      });
    });

    it("Given incomplete credentials, When resolving, Then returns null", () => {
      expect(resolveFeishuCredentials({ appId: "x" } as any)).toBeNull();
    });
  });

  describe("resolveFeishuAccount", () => {
    it("Given top-level and account overrides, When resolving account, Then account overrides win", () => {
      const cfg = {
        channels: {
          feishu: {
            enabled: true,
            appId: "base-app",
            appSecret: "base-secret",
            domain: "feishu",
            renderMode: "raw",
            accounts: {
              teama: {
                name: " Team A ",
                appSecret: "account-secret",
                renderMode: "card",
              },
            },
          },
        },
      } as any;

      const resolved = resolveFeishuAccount({ cfg, accountId: "teama" });
      expect(resolved.accountId).toBe("teama");
      expect(resolved.enabled).toBe(true);
      expect(resolved.configured).toBe(true);
      expect(resolved.name).toBe("Team A");
      expect(resolved.appId).toBe("base-app");
      expect(resolved.appSecret).toBe("account-secret");
      expect(resolved.config.renderMode).toBe("card");
    });

    it("Given mixed-case accountId input, When resolving, Then account id is normalized to lowercase", () => {
      const cfg = {
        channels: {
          feishu: {
            appId: "base-app",
            appSecret: "base-secret",
            accounts: {
              teama: {
                appSecret: "team-secret",
              },
            },
          },
        },
      } as any;

      const resolved = resolveFeishuAccount({ cfg, accountId: "TeamA" });
      expect(resolved.accountId).toBe("teama");
      expect(resolved.appSecret).toBe("team-secret");
    });

    it("Given top-level enabled=false, When resolving enabled account, Then final account is disabled", () => {
      const cfg = {
        channels: {
          feishu: {
            enabled: false,
            appId: "base-app",
            appSecret: "base-secret",
            accounts: {
              teama: {
                enabled: true,
              },
            },
          },
        },
      } as any;
      const resolved = resolveFeishuAccount({ cfg, accountId: "teama" });
      expect(resolved.enabled).toBe(false);
    });
  });

  describe("listEnabledFeishuAccounts", () => {
    it("Given mixed account states, When listing enabled accounts, Then returns only enabled+configured accounts", () => {
      const cfg = {
        channels: {
          feishu: {
            enabled: true,
            appId: "base-app",
            appSecret: "base-secret",
            accounts: {
              enabledaccount: {
                enabled: true,
              },
              disabledaccount: {
                enabled: false,
              },
              nocreds: {
                appId: "",
                appSecret: "",
              },
            },
          },
        },
      } as any;

      const accounts = listEnabledFeishuAccounts(cfg);
      expect(accounts.map((a) => a.accountId)).toEqual(["enabledaccount"]);
    });
  });
});
