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
});
