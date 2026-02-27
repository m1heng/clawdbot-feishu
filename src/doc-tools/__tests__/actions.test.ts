import { describe, expect, it, vi } from "vitest";
import { runDocAction } from "../actions.js";

function createClientMocks() {
  const rawContent = vi.fn();
  const getDocument = vi.fn();
  const listBlocks = vi.fn();
  const getTenantAccessToken = vi.fn();
  const legacyRawContent = vi.fn();

  const client = {
    domain: "https://open.feishu.cn",
    tokenManager: { getTenantAccessToken },
    httpInstance: { get: legacyRawContent },
    docx: {
      document: {
        rawContent,
        get: getDocument,
      },
      documentBlock: {
        list: listBlocks,
      },
    },
    drive: {
      fileComment: {
        list: vi.fn(),
        create: vi.fn(),
        get: vi.fn(),
      },
      fileCommentReply: {
        list: vi.fn(),
      },
    },
    application: {
      scope: {
        list: vi.fn(),
      },
    },
  } as any;

  return {
    client,
    rawContent,
    getDocument,
    listBlocks,
    getTenantAccessToken,
    legacyRawContent,
  };
}

describe("doc-tools/actions read contract", () => {
  it("Given legacy token, When action=read, Then uses legacy doc API", async () => {
    const { client, rawContent, getDocument, listBlocks, getTenantAccessToken, legacyRawContent } =
      createClientMocks();
    getTenantAccessToken.mockResolvedValue("tenant-token");
    legacyRawContent.mockResolvedValue({
      code: 0,
      data: { content: "legacy raw text" },
    });

    const result = await runDocAction(
      client,
      { action: "read", doc_token: "doccnABC123" } as any,
      1024,
    );

    expect(result).toEqual({
      content: "legacy raw text",
      format: "doc",
      hint: "Legacy document format. Only plain text content available. Title not included in this API response.",
    });
    expect(getTenantAccessToken).toHaveBeenCalledTimes(1);
    expect(legacyRawContent).toHaveBeenCalledWith(
      "https://open.feishu.cn/open-apis/doc/v2/doccnABC123/raw_content",
      {
        headers: { Authorization: "Bearer tenant-token" },
      },
    );
    expect(rawContent).not.toHaveBeenCalled();
    expect(getDocument).not.toHaveBeenCalled();
    expect(listBlocks).not.toHaveBeenCalled();
  });

  it("Given docx token, When action=read, Then uses docx APIs and returns block summary", async () => {
    const { client, rawContent, getDocument, listBlocks, getTenantAccessToken, legacyRawContent } =
      createClientMocks();
    rawContent.mockResolvedValue({ code: 0, data: { content: "docx raw text" } });
    getDocument.mockResolvedValue({
      code: 0,
      data: { document: { title: "Docx Title", revision_id: 7 } },
    });
    listBlocks.mockResolvedValue({
      code: 0,
      data: {
        items: [{ block_type: 31 }, { block_type: 2 }],
      },
    });

    const result = await runDocAction(
      client,
      { action: "read", doc_token: "doxcnABC123" } as any,
      1024,
    );

    expect(result).toEqual({
      title: "Docx Title",
      content: "docx raw text",
      revision_id: 7,
      block_count: 2,
      block_types: { Table: 1, Text: 1 },
      hint: 'This document contains Table which are NOT included in the plain text above. Use feishu_doc with action: "list_blocks" to get full content.',
    });
    expect(rawContent).toHaveBeenCalledWith({ path: { document_id: "doxcnABC123" } });
    expect(getDocument).toHaveBeenCalledWith({ path: { document_id: "doxcnABC123" } });
    expect(listBlocks).toHaveBeenCalledWith({ path: { document_id: "doxcnABC123" } });
    expect(getTenantAccessToken).not.toHaveBeenCalled();
    expect(legacyRawContent).not.toHaveBeenCalled();
  });
});
