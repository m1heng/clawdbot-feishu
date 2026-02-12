import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { neutralizeOrderedMarkers } from "./docx.js";

describe("neutralizeOrderedMarkers", () => {
  it("standard ordered list: 1. / 2.", () => {
    const input = "1. First\n2. Second";
    const expected = "**1.** First\n**2.** Second";
    assert.equal(neutralizeOrderedMarkers(input), expected);
  });

  it("multi-digit number: 10.", () => {
    assert.equal(neutralizeOrderedMarkers("10. Tenth"), "**10.** Tenth");
  });

  it("half-width parenthesis: 1)", () => {
    assert.equal(neutralizeOrderedMarkers("1) First"), "**1)** First");
  });

  it("full-width parenthesis: 1）", () => {
    assert.equal(neutralizeOrderedMarkers("1） First"), "**1）** First");
  });

  it("Chinese square brackets: 【01】", () => {
    const input = "【01】评估\n【02】干预";
    const expected = "**【01】** 评估\n**【02】** 干预";
    assert.equal(neutralizeOrderedMarkers(input), expected);
  });

  it("Chinese parentheses: （1）", () => {
    assert.equal(neutralizeOrderedMarkers("（1）概述"), "**（1）** 概述");
  });

  it("unordered list unchanged", () => {
    assert.equal(neutralizeOrderedMarkers("- Item"), "- Item");
  });

  it("heading unchanged", () => {
    assert.equal(neutralizeOrderedMarkers("## Title"), "## Title");
  });

  it("inline number unchanged", () => {
    assert.equal(
      neutralizeOrderedMarkers("This has 1. in middle"),
      "This has 1. in middle",
    );
  });

  it("indented list", () => {
    assert.equal(neutralizeOrderedMarkers("  1. Indented"), "  **1.** Indented");
  });

  it("mixed content preserves non-list lines", () => {
    const input = "# H1\n1. Item\n- Bullet";
    const expected = "# H1\n**1.** Item\n- Bullet";
    assert.equal(neutralizeOrderedMarkers(input), expected);
  });

  it("multi-digit consecutive: 10. / 11.", () => {
    const input = "10. Tenth\n11. Eleventh";
    const expected = "**10.** Tenth\n**11.** Eleventh";
    assert.equal(neutralizeOrderedMarkers(input), expected);
  });

  it("clinical scenario: family intervention plan", () => {
    const input = [
      "# 家庭干预方案",
      "",
      "【01】初始评估（2周）",
      "【02】家庭动力分析（3周）",
      "【03】结构式干预（8周）",
      "",
      "- 注意事项一",
      "- 注意事项二",
    ].join("\n");

    const expected = [
      "# 家庭干预方案",
      "",
      "**【01】** 初始评估（2周）",
      "**【02】** 家庭动力分析（3周）",
      "**【03】** 结构式干预（8周）",
      "",
      "- 注意事项一",
      "- 注意事项二",
    ].join("\n");

    assert.equal(neutralizeOrderedMarkers(input), expected);
  });

  it("empty string returns empty", () => {
    assert.equal(neutralizeOrderedMarkers(""), "");
  });

  it("no markers returns input unchanged", () => {
    const input = "Just some plain text\nwith multiple lines.";
    assert.equal(neutralizeOrderedMarkers(input), input);
  });

  it("【01】 with no trailing space", () => {
    assert.equal(neutralizeOrderedMarkers("【01】评估"), "**【01】** 评估");
  });

  it("（1） with trailing space", () => {
    assert.equal(neutralizeOrderedMarkers("（1） 概述"), "**（1）** 概述");
  });
});
