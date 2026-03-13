import { beforeEach, describe, expect, it, vi } from "vitest";

// --- hoisted mocks (must be before any imports) ---

const resolveFeishuAccountMock = vi.hoisted(() => vi.fn());
const getFeishuRuntimeMock = vi.hoisted(() => vi.fn());
const sendMessageFeishuMock = vi.hoisted(() => vi.fn());
const sendMarkdownCardFeishuMock = vi.hoisted(() => vi.fn());
const createFeishuClientMock = vi.hoisted(() => vi.fn());
const resolveReceiveIdTypeMock = vi.hoisted(() => vi.fn());
const createReplyDispatcherWithTypingMock = vi.hoisted(() => vi.fn());
const addTypingIndicatorMock = vi.hoisted(() => vi.fn(async () => ({ messageId: "om_msg" })));
const removeTypingIndicatorMock = vi.hoisted(() => vi.fn(async () => {}));
const normalizeFeishuMarkdownLinksMock = vi.hoisted(() => vi.fn((t: string) => t));
// streamingInstances must be hoisted so the vi.mock factory (which is also hoisted) can reference it
const streamingInstances = vi.hoisted(() => [] as Array<{
  active: boolean;
  start: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  isActive: ReturnType<typeof vi.fn>;
}>);

vi.mock("openclaw/plugin-sdk", () => ({
  createReplyPrefixContext: vi.fn(() => ({
    responsePrefix: undefined,
    responsePrefixContextProvider: undefined,
    onModelSelected: vi.fn(),
  })),
  createTypingCallbacks: vi.fn((opts: Record<string, unknown>) => ({
    onReplyStart: opts.start,
    onIdle: opts.stop,
    onCleanup: vi.fn(),
  })),
  logTypingFailure: vi.fn(),
}));
vi.mock("../accounts.js", () => ({ resolveFeishuAccount: resolveFeishuAccountMock }));
vi.mock("../runtime.js", () => ({ getFeishuRuntime: getFeishuRuntimeMock }));
vi.mock("../send.js", () => ({
  sendMessageFeishu: sendMessageFeishuMock,
  sendMarkdownCardFeishu: sendMarkdownCardFeishuMock,
}));
vi.mock("../client.js", () => ({ createFeishuClient: createFeishuClientMock }));
vi.mock("../targets.js", () => ({ resolveReceiveIdType: resolveReceiveIdTypeMock }));
vi.mock("../typing.js", () => ({
  addTypingIndicator: addTypingIndicatorMock,
  removeTypingIndicator: removeTypingIndicatorMock,
}));
vi.mock("../mention.js", () => ({
  buildMentionedCardContent: vi.fn((_targets: unknown, text: string) => text),
}));
vi.mock("../text/markdown-links.js", () => ({
  normalizeFeishuMarkdownLinks: normalizeFeishuMarkdownLinksMock,
}));
vi.mock("../streaming-card.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../streaming-card.js")>();
  return {
    mergeStreamingText: actual.mergeStreamingText,
    FeishuStreamingSession: class {
      active = false;
      start = vi.fn(async () => { this.active = true; });
      update = vi.fn(async () => {});
      close = vi.fn(async () => { this.active = false; });
      isActive = vi.fn(() => this.active);
      constructor() { streamingInstances.push(this as never); }
    },
  };
});

import { createFeishuReplyDispatcher } from "../reply-dispatcher.js";

type CapturedOpts = {
  deliver: (payload: { text?: string }, info?: { kind?: string }) => Promise<void>;
  onIdle: () => Promise<void>;
  onReplyStart: () => void;
};

function makeDispatcher() {
  createFeishuReplyDispatcher({
    cfg: {} as never,
    agentId: "agent",
    runtime: { log: vi.fn(), error: vi.fn() } as never,
    chatId: "oc_chat",
  });
}

function getLastOpts(): CapturedOpts {
  const calls = createReplyDispatcherWithTypingMock.mock.calls;
  return calls[calls.length - 1]?.[0] as CapturedOpts;
}

function getLastReplyOptions() {
  const results = createReplyDispatcherWithTypingMock.mock.results;
  return (results[results.length - 1]?.value as { replyOptions: { onPartialReply?: (p: { text?: string }) => void } })
    .replyOptions;
}

const defaultAccountConfig = {
  accountId: "main",
  appId: "app_id",
  appSecret: "app_secret",
  domain: "feishu",
  config: { renderMode: "auto", streaming: true },
};

const defaultRuntime = {
  channel: {
    text: {
      resolveTextChunkLimit: vi.fn(() => 4000),
      resolveChunkMode: vi.fn(() => "line"),
      resolveMarkdownTableMode: vi.fn(() => "preserve"),
      convertMarkdownTables: vi.fn((t: string) => t),
      chunkTextWithMode: vi.fn((t: string) => [t]),
    },
    reply: {
      createReplyDispatcherWithTyping: createReplyDispatcherWithTypingMock,
      resolveHumanDelayConfig: vi.fn(() => undefined),
    },
  },
};

describe("createFeishuReplyDispatcher — block payload handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamingInstances.length = 0;
    resolveFeishuAccountMock.mockReturnValue(defaultAccountConfig);
    resolveReceiveIdTypeMock.mockReturnValue("chat_id");
    createFeishuClientMock.mockReturnValue({});
    normalizeFeishuMarkdownLinksMock.mockImplementation((t: string) => t);
    createReplyDispatcherWithTypingMock.mockImplementation(() => ({
      dispatcher: {},
      replyOptions: {},
      markDispatchIdle: vi.fn(),
    }));
    getFeishuRuntimeMock.mockReturnValue(defaultRuntime);
  });

  it("suppresses block chunk that would not trigger card mode (plain text)", async () => {
    makeDispatcher();
    await getLastOpts().deliver({ text: "internal reasoning" }, { kind: "block" });

    expect(streamingInstances).toHaveLength(0);
    expect(sendMessageFeishuMock).not.toHaveBeenCalled();
    expect(sendMarkdownCardFeishuMock).not.toHaveBeenCalled();
  });

  it("uses block chunk as streaming fallback when text triggers card mode", async () => {
    makeDispatcher();
    const opts = getLastOpts();

    await opts.deliver({ text: "```ts\nconst x = 1\n```" }, { kind: "block" });
    await opts.onIdle();

    expect(streamingInstances).toHaveLength(1);
    expect(streamingInstances[0]!.start).toHaveBeenCalledTimes(1);
    expect(streamingInstances[0]!.close).toHaveBeenCalledWith("```ts\nconst x = 1\n```");
  });

  it("closes with block text when final payload is never delivered (regression #30663)", async () => {
    makeDispatcher();
    const opts = getLastOpts();

    await opts.deliver({ text: "```md\npartial answer\n```" }, { kind: "block" });
    await opts.onIdle();

    expect(streamingInstances[0]!.close).toHaveBeenCalledWith("```md\npartial answer\n```");
    expect(sendMarkdownCardFeishuMock).not.toHaveBeenCalled();
  });

  it("handles cumulative block chunks without duplicating text", async () => {
    makeDispatcher();
    const opts = getLastOpts();

    // Cumulative: second chunk already contains all of first
    await opts.deliver({ text: "```ts\nhello" }, { kind: "block" });
    await opts.deliver({ text: "```ts\nhello world\n```" }, { kind: "block" });
    await opts.onIdle();

    expect(streamingInstances[0]!.close).toHaveBeenCalledWith("```ts\nhello world\n```");
  });

  it("final payload overrides accumulated block text", async () => {
    makeDispatcher();
    const opts = getLastOpts();

    await opts.deliver({ text: "```ts\nblock text\n```" }, { kind: "block" });
    await opts.deliver({ text: "```ts\nfinal text\n```" }, { kind: "final" });
    await opts.onIdle();

    expect(streamingInstances[0]!.close).toHaveBeenCalledWith("```ts\nfinal text\n```");
  });
});

describe("createFeishuReplyDispatcher — thinking block deduplication (#399)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamingInstances.length = 0;
    resolveFeishuAccountMock.mockReturnValue({
      ...defaultAccountConfig,
      config: { renderMode: "card", streaming: true },
    });
    resolveReceiveIdTypeMock.mockReturnValue("chat_id");
    createFeishuClientMock.mockReturnValue({});
    normalizeFeishuMarkdownLinksMock.mockImplementation((t: string) => t);
    createReplyDispatcherWithTypingMock.mockImplementation(() => ({
      dispatcher: {},
      replyOptions: {},
      markDispatchIdle: vi.fn(),
    }));
    getFeishuRuntimeMock.mockReturnValue(defaultRuntime);
  });

  it("does not duplicate thinking text when partials arrive before block payload", async () => {
    const result = createFeishuReplyDispatcher({
      cfg: {} as never,
      agentId: "agent",
      runtime: { log: vi.fn(), error: vi.fn() } as never,
      chatId: "oc_chat",
    });
    const opts = getLastOpts();
    const { onPartialReply } = result.replyOptions;

    // Start streaming session
    opts.onReplyStart();
    await new Promise((r) => setTimeout(r, 0));

    const instance = streamingInstances[0]!;

    // Simulate thinking tokens arriving via onPartialReply (cumulative)
    onPartialReply!({ text: "thinking step 1" });
    onPartialReply!({ text: "thinking step 1\nthinking step 2" });
    await new Promise((r) => setTimeout(r, 0));

    // Then response tokens start
    onPartialReply!({ text: "thinking step 1\nthinking step 2\nresponse start" });
    await new Promise((r) => setTimeout(r, 0));

    // Now the block payload arrives with the same thinking text
    await opts.deliver(
      { text: "thinking step 1\nthinking step 2" },
      { kind: "block" },
    );
    await new Promise((r) => setTimeout(r, 0));

    // The last update should NOT contain duplicated thinking
    const lastUpdateCall = instance.update.mock.calls[instance.update.mock.calls.length - 1];
    const lastText = lastUpdateCall?.[0] as string | undefined;
    if (lastText) {
      const thinkingOccurrences = lastText.split("thinking step 1").length - 1;
      expect(thinkingOccurrences).toBe(1);
    }
  });

  it("still accepts block content when no partials have arrived", async () => {
    makeDispatcher();
    const opts = getLastOpts();

    // Block arrives without any prior partials (regression #30663)
    await opts.deliver({ text: "```ts\nreasoning block\n```" }, { kind: "block" });
    await opts.onIdle();

    expect(streamingInstances).toHaveLength(1);
    expect(streamingInstances[0]!.close).toHaveBeenCalledWith("```ts\nreasoning block\n```");
  });

  it("does not send a second card after streaming closes (#399)", async () => {
    makeDispatcher();
    const opts = getLastOpts();

    // First deliver closes the streaming card
    await opts.deliver({ text: "```ts\nfinal\n```" }, { kind: "final" });

    // Second deliver arrives after streaming is already closed
    await opts.deliver({ text: "```ts\nfinal\n```" }, { kind: "final" });

    // Should NOT fall through to sendMarkdownCardFeishu
    expect(sendMarkdownCardFeishuMock).not.toHaveBeenCalled();
    expect(sendMessageFeishuMock).not.toHaveBeenCalled();
  });
});

describe("createFeishuReplyDispatcher — onPartialReply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamingInstances.length = 0;
    resolveFeishuAccountMock.mockReturnValue(defaultAccountConfig);
    resolveReceiveIdTypeMock.mockReturnValue("chat_id");
    createFeishuClientMock.mockReturnValue({});
    normalizeFeishuMarkdownLinksMock.mockImplementation((t: string) => t);
    createReplyDispatcherWithTypingMock.mockImplementation(() => ({
      dispatcher: {},
      replyOptions: {},
      markDispatchIdle: vi.fn(),
    }));
    getFeishuRuntimeMock.mockReturnValue(defaultRuntime);
  });

  it("deduplicates identical consecutive partial payloads", async () => {
    const result = createFeishuReplyDispatcher({
      cfg: {} as never,
      agentId: "agent",
      runtime: { log: vi.fn(), error: vi.fn() } as never,
      chatId: "oc_chat",
    });
    const opts = getLastOpts();
    const { onPartialReply } = result.replyOptions;
    expect(onPartialReply).toBeDefined();

    // Trigger streaming session
    opts.onReplyStart();
    await opts.deliver({ text: "```ts\ncode\n```" }, { kind: "final" });
    await new Promise((r) => setTimeout(r, 0));

    const instance = streamingInstances[streamingInstances.length - 1]!;
    const updatesBefore = instance.update.mock.calls.length;

    onPartialReply!({ text: "hello" });
    onPartialReply!({ text: "hello" }); // identical — should be deduped

    await new Promise((r) => setTimeout(r, 0));

    // At most 1 additional update for identical partials
    expect(instance.update.mock.calls.length - updatesBefore).toBeLessThanOrEqual(1);
  });

  it("applies normalizeFeishuMarkdownLinks to partial text", () => {
    normalizeFeishuMarkdownLinksMock.mockImplementation((t: string) => `[norm]${t}`);

    const result = createFeishuReplyDispatcher({
      cfg: {} as never,
      agentId: "agent",
      runtime: { log: vi.fn(), error: vi.fn() } as never,
      chatId: "oc_chat",
    });
    const { onPartialReply } = result.replyOptions;

    onPartialReply?.({ text: "some text" });

    expect(normalizeFeishuMarkdownLinksMock).toHaveBeenCalledWith("some text");
  });

  it("does not create onPartialReply when streaming is disabled", () => {
    resolveFeishuAccountMock.mockReturnValue({
      ...defaultAccountConfig,
      config: { renderMode: "auto", streaming: false },
    });

    makeDispatcher();
    const { onPartialReply } = getLastReplyOptions();

    expect(onPartialReply).toBeUndefined();
  });
});
