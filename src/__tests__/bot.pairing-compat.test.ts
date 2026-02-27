import { beforeEach, describe, expect, it, vi } from "vitest";

function buildDmEvent(messageId: string, senderOpenId = "ou_sender") {
  return {
    sender: {
      sender_id: {
        open_id: senderOpenId,
        user_id: `u_${senderOpenId}`,
      },
    },
    message: {
      message_id: messageId,
      chat_id: "oc_dm",
      chat_type: "p2p",
      message_type: "text",
      content: JSON.stringify({ text: "hi" }),
    },
  } as const;
}

function buildCfg() {
  return {
    channels: {
      feishu: {
        dmPolicy: "pairing",
        allowFrom: [],
        accounts: {
          default: {
            dmPolicy: "pairing",
            allowFrom: [],
          },
        },
      },
    },
    commands: {},
  } as any;
}

async function setupPairingHarness(params: {
  readImpl: (...args: any[]) => Promise<Array<string | number>>;
  upsertImpl?: (...args: any[]) => Promise<{ code: string; created: boolean }>;
  routeImpl?: (...args: any[]) => any;
}) {
  vi.resetModules();
  vi.clearAllMocks();

  const sendMessageFeishu = vi.fn(async () => undefined);
  const getMessageFeishu = vi.fn(async () => null);
  vi.doMock("../send.js", () => ({
    sendMessageFeishu,
    getMessageFeishu,
  }));

  const runtimeMod = await import("../runtime.js");
  const botMod = await import("../bot.js");

  const readAllowFromStore = vi.fn(params.readImpl);
  const upsertPairingRequest = vi.fn(
    params.upsertImpl ??
      (async () => ({
        code: "9PQY2RSK",
        created: true,
      })),
  );
  const resolveAgentRoute = vi.fn(
    params.routeImpl ??
      (() => ({
        sessionKey: "feishu:default:session",
        accountId: "default",
        agentId: "assistant",
        matchedBy: "default",
      })),
  );

  runtimeMod.setFeishuRuntime({
    version: "test",
    channel: {
      text: {
        hasControlCommand: vi.fn(() => false),
      },
      commands: {
        shouldComputeCommandAuthorized: vi.fn(() => false),
        shouldHandleTextCommands: vi.fn(() => false),
        resolveCommandAuthorizedFromAuthorizers: vi.fn(() => true),
      },
      pairing: {
        readAllowFromStore,
        upsertPairingRequest,
        buildPairingReply: vi.fn(() => "OpenClaw: access not configured."),
      },
      routing: {
        resolveAgentRoute,
      },
    },
    system: {
      enqueueSystemEvent: vi.fn(),
    },
  } as any);

  return {
    handleFeishuMessage: botMod.handleFeishuMessage,
    readAllowFromStore,
    upsertPairingRequest,
    resolveAgentRoute,
    sendMessageFeishu,
  };
}

describe("pairing api compatibility", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("detects scoped pairing runtime and writes pairing requests with accountId", async () => {
    const harness = await setupPairingHarness({
      // Scoped runtime emulation: reads object-style params (`params.channel`).
      readImpl: async (params: any) => {
        const channel = params?.channel;
        const accountId = params?.accountId;
        if (channel === "feishu" && accountId === "default") return [];
        return [];
      },
    });

    await harness.handleFeishuMessage({
      cfg: buildCfg(),
      event: buildDmEvent("om_scoped_unauthorized"),
      accountId: "default",
      runtime: {
        log: vi.fn(),
        error: vi.fn(),
      } as any,
    });

    expect(harness.readAllowFromStore).toHaveBeenCalledTimes(2);
    expect(harness.readAllowFromStore.mock.calls[1]?.[0]).toMatchObject({
      channel: "feishu",
      accountId: "default",
    });
    expect(harness.upsertPairingRequest).toHaveBeenCalledTimes(1);
    expect(harness.upsertPairingRequest.mock.calls[0]?.[0]).toMatchObject({
      channel: "feishu",
      id: "ou_sender",
      accountId: "default",
    });
    expect(harness.sendMessageFeishu).toHaveBeenCalledTimes(1);
  });

  it("detects legacy pairing runtime and keeps legacy upsert call shape", async () => {
    const harness = await setupPairingHarness({
      // Legacy runtime emulation: expects positional params only.
      readImpl: async (channel: string, _env?: unknown, accountId?: string) => {
        if (channel === "feishu" && accountId === "default") return [];
        return [];
      },
    });

    await harness.handleFeishuMessage({
      cfg: buildCfg(),
      event: buildDmEvent("om_legacy_unauthorized"),
      accountId: "default",
      runtime: {
        log: vi.fn(),
        error: vi.fn(),
      } as any,
    });

    expect(harness.readAllowFromStore).toHaveBeenCalledTimes(2);
    expect(harness.readAllowFromStore.mock.calls[1]?.[0]).toBe("feishu");
    expect(harness.readAllowFromStore.mock.calls[1]?.[2]).toBe("default");
    expect(harness.upsertPairingRequest).toHaveBeenCalledTimes(1);
    expect(harness.upsertPairingRequest.mock.calls[0]?.[0]).toMatchObject({
      channel: "feishu",
      id: "ou_sender",
    });
    expect("accountId" in (harness.upsertPairingRequest.mock.calls[0]?.[0] ?? {})).toBe(false);
    expect(harness.sendMessageFeishu).toHaveBeenCalledTimes(1);
  });

  it("uses scoped allowFrom to skip re-pairing after approval", async () => {
    const harness = await setupPairingHarness({
      readImpl: async (params: any) => {
        const channel = params?.channel;
        const accountId = params?.accountId;
        if (channel === "feishu" && accountId === "default") return ["ou_sender"];
        return [];
      },
      // Once sender is authorized, route resolution should be reached and pairing should not upsert.
      routeImpl: () => {
        throw new Error("route reached");
      },
    });
    const errorSpy = vi.fn();

    await harness.handleFeishuMessage({
      cfg: buildCfg(),
      event: buildDmEvent("om_scoped_authorized"),
      accountId: "default",
      runtime: {
        log: vi.fn(),
        error: errorSpy,
      } as any,
    });

    expect(harness.upsertPairingRequest).not.toHaveBeenCalled();
    expect(harness.sendMessageFeishu).not.toHaveBeenCalled();
    expect(harness.resolveAgentRoute).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("route reached"));
  });
});
