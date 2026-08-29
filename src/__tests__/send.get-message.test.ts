import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client.js", () => ({
  createFeishuClient: vi.fn(),
}));

import { createFeishuClient } from "../client.js";
import { getMessageFeishu } from "../send.js";

describe("getMessageFeishu", () => {
  const cfg = {
    channels: {
      feishu: {
        appId: "cli_test",
        appSecret: "sec_test",
      },
    },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns plain text for normal text messages", async () => {
    const get = vi.fn(async () => ({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_text_1",
            chat_id: "oc_chat_1",
            msg_type: "text",
            body: { content: JSON.stringify({ text: "hello world" }) },
            sender: { id: "ou_sender", id_type: "open_id" },
            create_time: "1700000000000",
          },
        ],
      },
    }));

    vi.mocked(createFeishuClient).mockReturnValue({
      im: {
        message: { get },
      },
    } as any);

    const message = await getMessageFeishu({ cfg, messageId: "om_text_1" });
    expect(message?.messageId).toBe("om_text_1");
    expect(message?.chatId).toBe("oc_chat_1");
    expect(message?.contentType).toBe("text");
    expect(message?.content).toBe("hello world");
    expect(message?.senderOpenId).toBe("ou_sender");
    expect(message?.senderName).toBe("open_id:ou_sender");
  });

  it("returns sender identity for quoted-message attribution", async () => {
    const get = vi.fn(async () => ({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_quoted_1",
            chat_id: "oc_chat_1",
            msg_type: "text",
            body: { content: JSON.stringify({ text: "original statement" }) },
            sender: { id: "ou_alice", id_type: "open_id", sender_type: "user" },
            create_time: "1700000000000",
          },
        ],
      },
    }));
    const userGet = vi.fn(async () => ({
      data: { user: { name: "Alice" } },
    }));

    vi.mocked(createFeishuClient).mockReturnValue({
      im: {
        message: { get },
      },
      contact: {
        user: { get: userGet },
      },
    } as any);

    const message = await getMessageFeishu({ cfg, messageId: "om_quoted_1" });

    expect(userGet).toHaveBeenCalledWith({
      path: { user_id: "ou_alice" },
      params: { user_id_type: "open_id" },
    });
    expect(message?.senderId).toBe("ou_alice");
    expect(message?.senderOpenId).toBe("ou_alice");
    expect(message?.senderName).toBe("Alice");
  });

  it("resolves configured app display name for app sender in merge_forward", async () => {
    const cfgWithName = {
      channels: {
        feishu: {
          appId: "cli_test",
          appSecret: "sec_test",
          accounts: {
            lobster3: {
              appId: "cli_a906c00cb078dbc7",
              appSecret: "sec_lobster3",
              name: "Lobster Three",
            },
          },
        },
      },
    } as any;
    const get = vi.fn(async () => ({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_merge_appid",
            chat_id: "oc_chat_appid_1",
            msg_type: "merge_forward",
            body: { content: JSON.stringify({ title: "group chat" }) },
            sender: { id: "ou_sender", id_type: "open_id", sender_type: "user" },
            create_time: "1700000000000",
          },
          {
            message_id: "om_child_appid_1",
            msg_type: "text",
            body: { content: JSON.stringify({ text: "收到，继续处理" }) },
            sender: { id: "cli_a906c00cb078dbc7", id_type: "app_id", sender_type: "app" },
            create_time: "1700000000001",
          },
        ],
      },
    }));

    vi.mocked(createFeishuClient).mockReturnValue({
      im: { message: { get } },
    } as any);

    const message = await getMessageFeishu({ cfg: cfgWithName, messageId: "om_merge_appid" });
    expect(message?.content).toBe("[Lobster Three] 收到，继续处理");
  });

  it("falls back to accountId label when app sender has no configured name", async () => {
    const cfgNoName = {
      channels: {
        feishu: {
          appId: "cli_test",
          appSecret: "sec_test",
          accounts: {
            lobster3: {
              appId: "cli_a906c00cb078dbc7",
              appSecret: "sec_lobster3",
              // no explicit name field
            },
          },
        },
      },
    } as any;
    const get = vi.fn(async () => ({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_merge_noname",
            chat_id: "oc_chat_noname_1",
            msg_type: "merge_forward",
            body: { content: JSON.stringify({ title: "group chat" }) },
            sender: { id: "ou_sender", id_type: "open_id", sender_type: "user" },
            create_time: "1700000000000",
          },
          {
            message_id: "om_child_noname_1",
            msg_type: "text",
            body: { content: JSON.stringify({ text: "在的，处理中" }) },
            sender: { id: "cli_a906c00cb078dbc7", id_type: "app_id", sender_type: "app" },
            create_time: "1700000000001",
          },
        ],
      },
    }));

    vi.mocked(createFeishuClient).mockReturnValue({
      im: { message: { get } },
    } as any);

    const message = await getMessageFeishu({ cfg: cfgNoName, messageId: "om_merge_noname" });
    // Falls back to the account key when no explicit name is configured.
    expect(message?.content).toBe("[lobster3] 在的，处理中");
  });

  it("expands merge_forward child messages and keeps sender labels from payload only", async () => {
    const get = vi.fn(async () => ({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_merge_1",
            chat_id: "oc_chat_1",
            msg_type: "merge_forward",
            body: { content: JSON.stringify({ title: "wrapper" }) },
            sender: { id: "ou_sender", id_type: "open_id" },
            create_time: "1700000000001",
          },
          {
            message_id: "om_child_1",
            msg_type: "text",
            body: { content: JSON.stringify({ sender_name: "Alice", text: "first message" }) },
          },
          {
            message_id: "om_child_2",
            msg_type: "post",
            body: {
              content: JSON.stringify({
                sender: { name: "Bob" },
                content: [[{ tag: "text", text: "second message" }]],
              }),
            },
          },
        ],
      },
    }));

    vi.mocked(createFeishuClient).mockReturnValue({
      im: {
        message: { get },
      },
    } as any);

    const message = await getMessageFeishu({ cfg, messageId: "om_merge_1" });
    expect(message?.contentType).toBe("merge_forward");
    expect(message?.content).toBe("[Alice] first message\n\n---\n\n[Bob] second message");
  });

  it("falls back to wrapper content when merge_forward children are absent", async () => {
    const get = vi.fn(async () => ({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_merge_2",
            chat_id: "oc_chat_2",
            msg_type: "merge_forward",
            body: { content: JSON.stringify({ text: "fallback merge preview" }) },
            sender: { id: "ou_sender", id_type: "open_id" },
            create_time: "1700000000002",
          },
        ],
      },
    }));

    vi.mocked(createFeishuClient).mockReturnValue({
      im: {
        message: { get },
      },
    } as any);

    const message = await getMessageFeishu({ cfg, messageId: "om_merge_2" });
    expect(message?.content).toBe("fallback merge preview");
  });

  it("resolves sender name from contact API when payload sender name is missing", async () => {
    const get = vi.fn(async () => ({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_merge_4",
            chat_id: "oc_chat_4",
            msg_type: "merge_forward",
            body: { content: JSON.stringify({ title: "wrapper" }) },
            sender: { id: "ou_sender", id_type: "open_id" },
            create_time: "1700000000004",
          },
          {
            message_id: "om_child_4",
            msg_type: "text",
            body: { content: JSON.stringify({ text: "line with contact lookup" }) },
            sender: { id: "ou_bob", id_type: "open_id" },
          },
        ],
      },
    }));
    const userGet = vi.fn(async () => ({
      data: { user: { name: "Bob" } },
    }));

    vi.mocked(createFeishuClient).mockReturnValue({
      im: {
        message: { get },
      },
      contact: {
        user: { get: userGet },
      },
    } as any);

    const message = await getMessageFeishu({ cfg, messageId: "om_merge_4" });
    expect(userGet).toHaveBeenCalledWith({
      path: { user_id: "ou_bob" },
      params: { user_id_type: "open_id" },
    });
    expect(message?.content).toBe("[Bob] line with contact lookup");
  });

  it("falls back to bot profile API name when account name is unavailable", async () => {
    const get = vi.fn(async () => ({
      code: 0,
      data: {
        items: [
          {
            message_id: "om_merge_6",
            chat_id: "oc_chat_6",
            msg_type: "merge_forward",
            body: { content: JSON.stringify({ title: "wrapper" }) },
            sender: { id: "ou_sender", id_type: "open_id" },
            create_time: "1700000000006",
          },
          {
            message_id: "om_child_6",
            msg_type: "text",
            body: { content: JSON.stringify({ text: "line from bot profile name" }) },
            sender: { id: "cli_test", id_type: "app_id", sender_type: "app" },
          },
        ],
      },
    }));
    const request = vi.fn(async () => ({
      code: 0,
      data: { bot: { app_name: "OpenClaw Bot" } },
    }));

    vi.mocked(createFeishuClient).mockReturnValue({
      im: {
        message: { get },
      },
      request,
    } as any);

    const message = await getMessageFeishu({ cfg, messageId: "om_merge_6" });
    expect(message?.content).toBe("[OpenClaw Bot] line from bot profile name");
    expect(request).toHaveBeenCalledWith({
      method: "GET",
      url: "/open-apis/bot/v3/info",
      data: {},
    });
  });

});
