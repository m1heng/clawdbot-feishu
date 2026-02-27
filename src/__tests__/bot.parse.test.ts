import { describe, expect, it } from "vitest";
import { parseFeishuMessageEvent, type FeishuMessageEvent } from "../bot.js";

function buildTextEvent(params: {
  chatType: "p2p" | "group";
  text: string;
  mentions?: FeishuMessageEvent["message"]["mentions"];
  rootId?: string;
  parentId?: string;
}): FeishuMessageEvent {
  return {
    sender: {
      sender_id: {
        open_id: "ou_sender",
        user_id: "u_sender",
      },
    },
    message: {
      message_id: "om_1",
      chat_id: "oc_group",
      chat_type: params.chatType,
      message_type: "text",
      content: JSON.stringify({ text: params.text }),
      mentions: params.mentions,
      root_id: params.rootId,
      parent_id: params.parentId,
    },
  };
}

describe("parseFeishuMessageEvent", () => {
  const botOpenId = "ou_bot";

  it("parses group text and populates mention-forward context", () => {
    const event = buildTextEvent({
      chatType: "group",
      text: "@_user_bot @_user_alice hello there",
      mentions: [
        { key: "@_user_bot", name: "Bot", id: { open_id: botOpenId } },
        { key: "@_user_alice", name: "Alice", id: { open_id: "ou_alice" } },
      ],
      rootId: "om_root",
      parentId: "om_parent",
    });

    const ctx = parseFeishuMessageEvent(event, botOpenId);
    expect(ctx.chatId).toBe("oc_group");
    expect(ctx.senderId).toBe("u_sender");
    expect(ctx.senderOpenId).toBe("ou_sender");
    expect(ctx.chatType).toBe("group");
    expect(ctx.mentionedBot).toBe(true);
    expect(ctx.hasAnyMention).toBe(true);
    expect(ctx.rootId).toBe("om_root");
    expect(ctx.parentId).toBe("om_parent");
    expect(ctx.content).toBe("hello there");
    expect(ctx.mentionTargets).toEqual([{ openId: "ou_alice", name: "Alice", key: "@_user_alice" }]);
    expect(ctx.mentionMessageBody).toBe("hello there");
  });

  it("supports DM mention-forward without bot mention", () => {
    const event = buildTextEvent({
      chatType: "p2p",
      text: "@_user_alice ping",
      mentions: [{ key: "@_user_alice", name: "Alice", id: { open_id: "ou_alice" } }],
    });

    const ctx = parseFeishuMessageEvent(event, botOpenId);
    expect(ctx.mentionedBot).toBe(false);
    expect(ctx.mentionTargets).toEqual([{ openId: "ou_alice", name: "Alice", key: "@_user_alice" }]);
    expect(ctx.mentionMessageBody).toBe("ping");
  });

  it("detects bot mention from post payload", () => {
    const event: FeishuMessageEvent = {
      sender: {
        sender_id: {
          open_id: "ou_sender",
          user_id: "u_sender",
        },
      },
      message: {
        message_id: "om_post_1",
        chat_id: "oc_group",
        chat_type: "group",
        message_type: "post",
        content: JSON.stringify({
          title: "Daily",
          content: [
            [
              { tag: "at", open_id: botOpenId, user_name: "Bot" },
              { tag: "text", text: " hello" },
            ],
            [{ tag: "text", text: "world" }],
          ],
        }),
      },
    };

    const ctx = parseFeishuMessageEvent(event, botOpenId);
    expect(ctx.contentType).toBe("post");
    expect(ctx.mentionedBot).toBe(true);
    expect(ctx.hasAnyMention).toBe(true);
    expect(ctx.content).toContain("Daily");
    expect(ctx.content).toContain("@Bot hello");
    expect(ctx.content).toContain("world");
  });
});
