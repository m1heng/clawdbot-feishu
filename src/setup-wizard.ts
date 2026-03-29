import type { ClawdbotConfig, ChannelPlugin } from "openclaw/plugin-sdk";
import type { ChannelSetupWizard } from "openclaw/plugin-sdk/setup";
import { feishuSetupWizard } from "openclaw/plugin-sdk/feishu";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId, promptAccountId } from "./sdk-compat.js";
import {
  listFeishuAccountIds,
  resolveConfiguredFeishuAccountKey,
  resolveDefaultFeishuAccountId,
  resolveFeishuAccount,
  resolveFeishuCredentials,
} from "./accounts.js";
import { probeFeishu } from "./probe.js";
import type { FeishuConfig } from "./types.js";

function patchFeishuAccountConfig(
  cfg: ClawdbotConfig,
  accountId: string,
  patch: Record<string, unknown>,
): ClawdbotConfig {
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;

  if (accountId === DEFAULT_ACCOUNT_ID) {
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        feishu: { ...feishuCfg, ...patch },
      },
    };
  }

  const accountKey = resolveConfiguredFeishuAccountKey(cfg, accountId) ?? accountId;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      feishu: {
        ...feishuCfg,
        accounts: {
          ...feishuCfg?.accounts,
          [accountKey]: { ...feishuCfg?.accounts?.[accountKey], ...patch },
        },
      },
    },
  };
}

const accountScopedFinalize: NonNullable<ChannelSetupWizard["finalize"]> = async ({
  cfg,
  accountId,
  prompter,
}) => {
  const account = resolveFeishuAccount({ cfg, accountId });
  const resolved = resolveFeishuCredentials(account.config);
  const hasConfigCreds = Boolean(account.config?.appId?.trim() && account.config?.appSecret?.trim());
  const accountLabel = accountId === DEFAULT_ACCOUNT_ID ? "default" : accountId;

  let next = cfg;
  let appId: string | null = null;
  let appSecret: string | null = null;

  if (!resolved) {
    await prompter.note(
      [
        "1) Go to Feishu Open Platform (open.feishu.cn)",
        "2) Create a self-built app",
        "3) Get App ID and App Secret from Credentials page",
        "4) Enable required permissions: im:message, im:chat, contact:user.base:readonly",
        "5) Publish the app or add it to a test group",
      ].join("\n"),
      `Feishu credentials (${accountLabel})`,
    );
  }

  if (hasConfigCreds) {
    const keep = await prompter.confirm({
      message: `Feishu credentials already configured for "${accountLabel}". Keep them?`,
      initialValue: true,
    });
    if (!keep) {
      appId = String(await prompter.text({
        message: `Enter Feishu App ID for "${accountLabel}"`,
        validate: (v) => (v?.trim() ? undefined : "Required"),
      })).trim();
      appSecret = String(await prompter.text({
        message: `Enter Feishu App Secret for "${accountLabel}"`,
        validate: (v) => (v?.trim() ? undefined : "Required"),
      })).trim();
    }
  } else {
    appId = String(await prompter.text({
      message: `Enter Feishu App ID for "${accountLabel}"`,
      initialValue: account.config?.appId?.trim() || undefined,
      validate: (v) => (v?.trim() ? undefined : "Required"),
    })).trim();
    appSecret = String(await prompter.text({
      message: `Enter Feishu App Secret for "${accountLabel}"`,
      validate: (v) => (v?.trim() ? undefined : "Required"),
    })).trim();
  }

  if (appId && appSecret) {
    next = patchFeishuAccountConfig(next, accountId, { enabled: true, appId, appSecret });
    try {
      const testAccount = resolveFeishuAccount({ cfg: next, accountId });
      const probe = await probeFeishu(testAccount);
      if (probe.ok) {
        await prompter.note(
          `Connected as ${probe.botName ?? probe.botOpenId ?? "bot"}`,
          `Feishu connection test (${accountLabel})`,
        );
      } else {
        await prompter.note(
          `Connection failed: ${probe.error ?? "unknown error"}`,
          `Feishu connection test (${accountLabel})`,
        );
      }
    } catch (err) {
      await prompter.note(`Connection test failed: ${String(err)}`, `Feishu connection test (${accountLabel})`);
    }
  } else {
    next = patchFeishuAccountConfig(next, accountId, { enabled: true });
  }

  const currentDomain = resolveFeishuAccount({ cfg: next, accountId }).config?.domain ?? "feishu";
  const domain = await prompter.select({
    message: `Which Feishu domain? (${accountLabel})`,
    options: [
      { value: "feishu", label: "Feishu (feishu.cn) - China" },
      { value: "lark", label: "Lark (larksuite.com) - International" },
    ],
    initialValue: currentDomain,
  });
  if (domain) {
    next = patchFeishuAccountConfig(next, accountId, { domain });
  }

  return { cfg: next };
};

export const feishuSetupWizardWithAccounts: NonNullable<ChannelPlugin["setupWizard"]> = {
  ...feishuSetupWizard,

  resolveShouldPromptAccountIds: ({ cfg }) => listFeishuAccountIds(cfg).length > 1,

  resolveAccountIdForConfigure: async ({
    cfg,
    prompter,
    accountOverride,
    shouldPromptAccountIds,
  }) => {
    if (accountOverride?.trim()) return normalizeAccountId(accountOverride);
    const defaultId = resolveDefaultFeishuAccountId(cfg);
    if (!shouldPromptAccountIds) return defaultId;
    return promptAccountId({
      cfg,
      prompter,
      label: "Feishu",
      currentId: defaultId,
      listAccountIds: listFeishuAccountIds,
      defaultAccountId: defaultId,
    });
  },

  finalize: async (params) => {
    if (params.accountId === DEFAULT_ACCOUNT_ID) {
      return feishuSetupWizard.finalize!(params);
    }
    return accountScopedFinalize(params);
  },
};
