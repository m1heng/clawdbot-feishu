import { describe, expect, it } from "vitest";
import {
  buildMentionedCardContent,
  buildMentionedMessage,
  extractMentionTargets,
  extractMessageBody,
  formatMentionAllForCard,
  formatMentionAllForText,
  formatMentionForCard,
  formatMentionForText,
  isMentionForwardRequest,
  type MentionTarget,
} from "../mention.js";

function buildEvent(params: {
  chatType: "p2p" | "group";
  mentions?: Array<{
    key: string;
    id: { open_id?: string };
    name: string;
  }>;
}) {
  return {
    message: {
      chat_type: params.chatType,
      mentions: params.mentions ?? [],
    },
  } as any;
}

describe("mention", () => {
  const botOpenId = "ou_bot";
  const alice = { key: "@_user_1", id: { open_id: "ou_alice" }, name: "Alice" };
  const bot = { key: "@_user_2", id: { open_id: botOpenId }, name: "Bot" };

  it("extracts mention targets and excludes bot or missing-open_id entries", () => {
    const event = buildEvent({
      chatType: "group",
      mentions: [alice, bot, { key: "@_user_3", id: {}, name: "NoId" }],
    });

    expect(extractMentionTargets(event, botOpenId)).toEqual([
      { openId: "ou_alice", name: "Alice", key: "@_user_1" },
    ]);
  });

  it("applies mention-forward trigger rules for DM and group chats", () => {
    const dmEvent = buildEvent({ chatType: "p2p", mentions: [alice] });
    expect(isMentionForwardRequest(dmEvent, botOpenId)).toBe(true);

    const groupOnlyBot = buildEvent({ chatType: "group", mentions: [bot] });
    expect(isMentionForwardRequest(groupOnlyBot, botOpenId)).toBe(false);

    const groupWithBotAndOthers = buildEvent({ chatType: "group", mentions: [bot, alice] });
    expect(isMentionForwardRequest(groupWithBotAndOthers, botOpenId)).toBe(true);
  });

  it("extracts message body by removing placeholders and normalizing spaces", () => {
    const body = extractMessageBody("@_user_1 hi @(x) there", ["@_user_1", "@(x)"]);
    expect(body).toBe("hi there");
  });

  it("formats mention markup for text and card", () => {
    const target: MentionTarget = { openId: "ou_alice", name: "Alice", key: "@_user_1" };
    expect(formatMentionForText(target)).toBe('<at user_id="ou_alice">Alice</at>');
    expect(formatMentionForCard(target)).toBe("<at id=ou_alice></at>");
    expect(formatMentionAllForText()).toBe('<at user_id="all">Everyone</at>');
    expect(formatMentionAllForCard()).toBe("<at id=all></at>");
  });

  it("builds message/card content with prepended mentions", () => {
    const targets: MentionTarget[] = [{ openId: "ou_alice", name: "Alice", key: "@_user_1" }];
    expect(buildMentionedMessage(targets, "hello")).toBe('<at user_id="ou_alice">Alice</at> hello');
    expect(buildMentionedCardContent(targets, "hello")).toBe("<at id=ou_alice></at> hello");
    expect(buildMentionedMessage([], "hello")).toBe("hello");
  });
});
