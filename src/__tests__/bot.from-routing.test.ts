import { beforeEach, describe, expect, it, vi } from "vitest";

async function setupHarness() {
  vi.resetModules();
  vi.clearAllMocks();

  const sendMessageFeishu = vi.fn(async () => undefined);
  const getMessageFeishu = vi.fn(async () => null);
  vi.doMock("../send.js", () => ({ sendMessageFeishu, getMessageFeishu }));

  const createFeishuReplyDispatcher = vi.fn(() => ({
    dispatcher: vi.fn(),
    replyOptions: {},
    markDispatchIdle: vi.fn(),
  }));
  vi.doMock("../reply-dispatcher.js", () => ({ createFeishuReplyDispatcher }));
  vi.doMock("../client.js", () => ({
    createFeishuClient: vi.fn(() => ({
      contact: {
        user: {
          get: vi.fn(async () => ({ data: { user: { name: "Sender" } } })),
        },
      },
    })),
  }));

  const runtimeMod = await import("../runtime.js");
  const botMod = await import("../bot.js");

  const finalizeInboundContext = vi.fn((ctx: any) => ctx);
  const dispatchReplyFromConfig = vi.fn(async () => ({
    queuedFinal: false,
    counts: { final: 1, partial: 0 },
  }));

  runtimeMod.setFeishuRuntime({
    version: "test",
    channel: {
      text: { hasControlCommand: vi.fn(() => false) },
      commands: {
        shouldComputeCommandAuthorized: vi.fn(() => false),
        shouldHandleTextCommands: vi.fn(() => false),
        resolveCommandAuthorizedFromAuthorizers: vi.fn(() => true),
      },
      pairing: {
        readAllowFromStore: vi.fn(async () => ["*"]),
        upsertPairingRequest: vi.fn(async () => ({ code: "X", created: true })),
        buildPairingReply: vi.fn(() => ""),
      },
      routing: {
        resolveAgentRoute: vi.fn(() => ({
          sessionKey: "feishu:default:session",
          accountId: "default",
          agentId: "assistant",
          matchedBy: "default",
        })),
      },
      reply: {
        resolveEnvelopeFormatOptions: vi.fn(() => ({})),
        formatAgentEnvelope: vi.fn(({ body }: { body: string }) => body),
        finalizeInboundContext,
        dispatchReplyFromConfig,
      },
    },
    system: { enqueueSystemEvent: vi.fn() },
  } as any);

  return {
    handleFeishuMessage: botMod.handleFeishuMessage,
    finalizeInboundContext,
  };
}

function buildCfg() {
  return {
    channels: {
      feishu: {
        appId: "cli_test",
        appSecret: "sec_test",
        dmPolicy: "open",
        allowFrom: ["*"],
        groupPolicy: "open",
        requireMention: false,
        allowMentionlessInMultiBotGroup: true,
      },
    },
    commands: {},
  } as any;
}

const runtime = { log: vi.fn(), error: vi.fn() } as any;

describe("From field routing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("group message From includes chatId for group-scoped session routing", async () => {
    const harness = await setupHarness();

    await harness.handleFeishuMessage({
      cfg: buildCfg(),
      event: {
        sender: { sender_id: { open_id: "ou_user1", user_id: "u_user1" } },
        message: {
          message_id: "om_group_msg",
          chat_id: "oc_group123",
          chat_type: "group",
          message_type: "text",
          content: JSON.stringify({ text: "hello" }),
        },
      },
      accountId: "default",
      runtime,
    });

    expect(harness.finalizeInboundContext).toHaveBeenCalledTimes(1);
    const ctx = harness.finalizeInboundContext.mock.calls[0]?.[0];
    expect(ctx.From).toBe("feishu:oc_group123:ou_user1");
    expect(ctx.To).toBe("chat:oc_group123");
  });

  it("DM message From contains only senderOpenId", async () => {
    const harness = await setupHarness();

    await harness.handleFeishuMessage({
      cfg: buildCfg(),
      event: {
        sender: { sender_id: { open_id: "ou_user2", user_id: "u_user2" } },
        message: {
          message_id: "om_dm_msg",
          chat_id: "oc_dm456",
          chat_type: "p2p",
          message_type: "text",
          content: JSON.stringify({ text: "hi" }),
        },
      },
      accountId: "default",
      runtime,
    });

    expect(harness.finalizeInboundContext).toHaveBeenCalledTimes(1);
    const ctx = harness.finalizeInboundContext.mock.calls[0]?.[0];
    expect(ctx.From).toBe("feishu:ou_user2");
    expect(ctx.To).toBe("user:ou_user2");
  });

  it("different users in the same group have distinct From but same group prefix", async () => {
    const harness = await setupHarness();

    await harness.handleFeishuMessage({
      cfg: buildCfg(),
      event: {
        sender: { sender_id: { open_id: "ou_alice", user_id: "u_alice" } },
        message: {
          message_id: "om_g1",
          chat_id: "oc_shared",
          chat_type: "group",
          message_type: "text",
          content: JSON.stringify({ text: "question A" }),
        },
      },
      accountId: "default",
      runtime,
    });

    await harness.handleFeishuMessage({
      cfg: buildCfg(),
      event: {
        sender: { sender_id: { open_id: "ou_bob", user_id: "u_bob" } },
        message: {
          message_id: "om_g2",
          chat_id: "oc_shared",
          chat_type: "group",
          message_type: "text",
          content: JSON.stringify({ text: "question B" }),
        },
      },
      accountId: "default",
      runtime,
    });

    expect(harness.finalizeInboundContext).toHaveBeenCalledTimes(2);
    const from1 = harness.finalizeInboundContext.mock.calls[0]?.[0]?.From;
    const from2 = harness.finalizeInboundContext.mock.calls[1]?.[0]?.From;

    // Both group-scoped with same chatId prefix
    expect(from1).toBe("feishu:oc_shared:ou_alice");
    expect(from2).toBe("feishu:oc_shared:ou_bob");

    // Different speakers are distinguishable
    expect(from1).not.toBe(from2);
  });
});
