import { describe, expect, it } from "vitest";
import { detectDocFormat } from "../common.js";

describe("doc-tools/common contract", () => {
  it("Given a doccn token, When detecting format, Then returns legacy doc", () => {
    expect(detectDocFormat("doccnABC123")).toBe("doc");
  });

  it("Given a token with docc prefix but not doccn, When detecting format, Then returns docx", () => {
    expect(detectDocFormat("doccABC123")).toBe("docx");
  });

  it("Given a doccn token with non-alphanumeric chars, When detecting format, Then returns docx", () => {
    expect(detectDocFormat("doccnabc-123")).toBe("docx");
  });

  it("Given a non-legacy token, When detecting format, Then returns docx", () => {
    expect(detectDocFormat("doxcnABC123")).toBe("docx");
  });
});
