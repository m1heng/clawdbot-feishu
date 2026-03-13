import { describe, expect, it } from "vitest";
import { mergeStreamingText } from "../streaming-card.js";

describe("mergeStreamingText", () => {
  it("returns next when previous is empty", () => {
    expect(mergeStreamingText("", "hello")).toBe("hello");
    expect(mergeStreamingText(undefined, "hello")).toBe("hello");
  });

  it("returns previous when next is empty", () => {
    expect(mergeStreamingText("hello", "")).toBe("hello");
    expect(mergeStreamingText("hello", undefined)).toBe("hello");
  });

  it("returns next for cumulative partials (next includes previous)", () => {
    expect(mergeStreamingText("hello", "hello world")).toBe("hello world");
    expect(mergeStreamingText("AB", "ABCD")).toBe("ABCD");
  });

  it("returns previous when previous already includes next", () => {
    expect(mergeStreamingText("hello world", "hello")).toBe("hello world");
    expect(mergeStreamingText("ABCD", "BC")).toBe("ABCD");
  });

  it("detects partial overlap between segments", () => {
    // After a tool call, partials restart within a new segment.
    // previous ends with the start of next.
    expect(mergeStreamingText("Prior text. 找到了", "找到了！")).toBe("Prior text. 找到了！");
    expect(mergeStreamingText("Prior text. 找到了！", "找到了！是")).toBe("Prior text. 找到了！是");
    expect(mergeStreamingText("ABCD", "CDEF")).toBe("ABCDEF");
  });

  it("appends truly incremental chunks with no overlap", () => {
    expect(mergeStreamingText("hello", " world")).toBe("hello world");
    expect(mergeStreamingText("ABC", "XYZ")).toBe("ABCXYZ");
  });

  it("handles identical texts", () => {
    expect(mergeStreamingText("same", "same")).toBe("same");
  });

  it("simulates full tool-call streaming scenario", () => {
    // Phase 1: initial response (cumulative partials)
    let text = mergeStreamingText("", "Let me search");
    expect(text).toBe("Let me search");
    text = mergeStreamingText(text, "Let me search for that:");
    expect(text).toBe("Let me search for that:");

    // Phase 2: after tool call, partials restart within new segment
    text = mergeStreamingText(text, "Found");
    expect(text).toBe("Let me search for that:Found");
    text = mergeStreamingText(text, "Found it!");
    expect(text).toBe("Let me search for that:Found it!");
    text = mergeStreamingText(text, "Found it! The answer is 42.");
    expect(text).toBe("Let me search for that:Found it! The answer is 42.");
  });
});
