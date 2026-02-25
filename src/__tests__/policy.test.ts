import { describe, expect, it } from "vitest";
import {
  isFeishuGroupAllowed,
  resolveFeishuAllowlistMatch,
  resolveFeishuGroupCommandMentionBypass,
  resolveFeishuGroupConfig,
  resolveFeishuGroupToolPolicy,
  resolveFeishuReplyPolicy,
} from "../policy.js";

describe("policy", () => {
  it("matches wildcard/id/name allowlist entries", () => {
    expect(
      resolveFeishuAllowlistMatch({
        allowFrom: ["*"],
        senderId: "ou_sender",
      }),
    ).toEqual({ allowed: true, matchKey: "*", matchSource: "wildcard" });

    expect(
      resolveFeishuAllowlistMatch({
        allowFrom: ["OU_SENDER"],
        senderId: "ou_sender",
      }),
    ).toEqual({ allowed: true, matchKey: "ou_sender", matchSource: "id" });

    expect(
      resolveFeishuAllowlistMatch({
        allowFrom: ["alice"],
        senderId: "ou_sender",
        senderName: "Alice",
      }),
    ).toEqual({ allowed: true, matchKey: "alice", matchSource: "name" });
  });

  it("resolves group config case-insensitively", () => {
    const cfg = {
      groups: {
        OC_123: { requireMention: false },
      },
    } as any;
    expect(
      resolveFeishuGroupConfig({
        cfg,
        groupId: "oc_123",
      }),
    ).toEqual({ requireMention: false });
  });

  it("resolves group tool policy from channel context", () => {
    const params = {
      cfg: {
        channels: {
          feishu: {
            groups: {
              oc_group: {
                tools: { allow: ["feishu_doc"], deny: ["feishu_perm"] },
              },
            },
          },
        },
      },
      groupId: "oc_group",
    } as any;

    expect(resolveFeishuGroupToolPolicy(params)).toEqual({
      allow: ["feishu_doc"],
      deny: ["feishu_perm"],
    });
  });

  it("enforces group access for open/allowlist/disabled modes", () => {
    expect(
      isFeishuGroupAllowed({
        groupPolicy: "disabled",
        allowFrom: ["*"],
        senderId: "oc_1",
      }),
    ).toBe(false);

    expect(
      isFeishuGroupAllowed({
        groupPolicy: "open",
        allowFrom: [],
        senderId: "oc_1",
      }),
    ).toBe(true);

    expect(
      isFeishuGroupAllowed({
        groupPolicy: "allowlist",
        allowFrom: ["oc_1"],
        senderId: "oc_1",
      }),
    ).toBe(true);
  });

  it("resolves reply mention policy by chat type and override precedence", () => {
    expect(
      resolveFeishuReplyPolicy({
        isDirectMessage: true,
      }),
    ).toEqual({ requireMention: false });

    expect(
      resolveFeishuReplyPolicy({
        isDirectMessage: false,
        globalConfig: { requireMention: true } as any,
        groupConfig: { requireMention: false } as any,
      }),
    ).toEqual({ requireMention: false });

    expect(
      resolveFeishuReplyPolicy({
        isDirectMessage: false,
        globalConfig: undefined,
        groupConfig: undefined,
      }),
    ).toEqual({ requireMention: true });
  });

  it("resolves command mention bypass with group > global > default precedence", () => {
    expect(
      resolveFeishuGroupCommandMentionBypass({
        groupConfig: { groupCommandMentionBypass: "always" } as any,
        globalConfig: { groupCommandMentionBypass: "never" } as any,
      }),
    ).toBe("always");

    expect(
      resolveFeishuGroupCommandMentionBypass({
        groupConfig: {} as any,
        globalConfig: { groupCommandMentionBypass: "never" } as any,
      }),
    ).toBe("never");

    expect(
      resolveFeishuGroupCommandMentionBypass({
        groupConfig: undefined,
        globalConfig: undefined,
      }),
    ).toBe("single_bot");
  });
});
