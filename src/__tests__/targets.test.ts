import { describe, expect, it } from "vitest";
import {
  detectIdType,
  formatFeishuTarget,
  looksLikeFeishuId,
  normalizeFeishuTarget,
  resolveReceiveIdType,
} from "../targets.js";

describe("targets", () => {
  it("detects id types from prefix and pattern", () => {
    expect(detectIdType("oc_123")).toBe("chat_id");
    expect(detectIdType("ou_123")).toBe("open_id");
    expect(detectIdType("user_123")).toBe("user_id");
    expect(detectIdType("bad:id")).toBeNull();
  });

  it("normalizes target prefixes case-insensitively", () => {
    expect(normalizeFeishuTarget(" chat:oc_1 ")).toBe("oc_1");
    expect(normalizeFeishuTarget("USER:ou_1")).toBe("ou_1");
    expect(normalizeFeishuTarget("open_id:ou_2")).toBe("ou_2");
    expect(normalizeFeishuTarget("ou_3")).toBe("ou_3");
    expect(normalizeFeishuTarget("   ")).toBeNull();
  });

  it("formats target with inferred or explicit type", () => {
    expect(formatFeishuTarget("oc_1")).toBe("chat:oc_1");
    expect(formatFeishuTarget("ou_1")).toBe("user:ou_1");
    expect(formatFeishuTarget("foo", "chat_id")).toBe("chat:foo");
    expect(formatFeishuTarget("foo", "open_id")).toBe("user:foo");
    expect(formatFeishuTarget("foo")).toBe("foo");
  });

  it("resolves receive id type", () => {
    expect(resolveReceiveIdType("oc_1")).toBe("chat_id");
    expect(resolveReceiveIdType("ou_1")).toBe("open_id");
    expect(resolveReceiveIdType("u_1")).toBe("user_id");
  });

  it("detects feishu-like id strings", () => {
    expect(looksLikeFeishuId("chat:oc_1")).toBe(true);
    expect(looksLikeFeishuId("user:ou_1")).toBe(true);
    expect(looksLikeFeishuId("open_id:ou_1")).toBe(true);
    expect(looksLikeFeishuId("oc_1")).toBe(true);
    expect(looksLikeFeishuId("ou_1")).toBe(true);
    expect(looksLikeFeishuId("plain-id")).toBe(false);
    expect(looksLikeFeishuId("")).toBe(false);
  });
});
