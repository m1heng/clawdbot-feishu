import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client.js", () => ({
  createFeishuClient: vi.fn(),
}));

import { createFeishuClient } from "../client.js";
import { uploadFileFeishu } from "../media.js";

describe("uploadFileFeishu file_name handling", () => {
  const cfg = {
    channels: {
      feishu: {
        appId: "cli_test",
        appSecret: "sec_test",
      },
    },
  } as any;

  let createSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    createSpy = vi.fn(async () => ({
      code: 0,
      file_key: "fk_test_123",
    }));
    vi.mocked(createFeishuClient).mockReturnValue({
      im: { file: { create: createSpy } },
    } as any);
  });

  it("passes ASCII filename as-is", async () => {
    await uploadFileFeishu({
      cfg,
      file: Buffer.from("hello"),
      fileName: "report.pdf",
      fileType: "pdf",
    });

    const data = createSpy.mock.calls[0][0].data;
    expect(data.file_name).toBe("report.pdf");
  });

  it("passes Chinese filename without percent-encoding", async () => {
    await uploadFileFeishu({
      cfg,
      file: Buffer.from("hello"),
      fileName: "测试文件1.txt",
      fileType: "stream",
    });

    const data = createSpy.mock.calls[0][0].data;
    expect(data.file_name).toBe("测试文件1.txt");
    expect(data.file_name).not.toContain("%");
  });

  it("passes filename with mixed scripts without encoding", async () => {
    const name = "プロジェクト—報告（最終版）.docx";
    await uploadFileFeishu({
      cfg,
      file: Buffer.from("hello"),
      fileName: name,
      fileType: "doc",
    });

    const data = createSpy.mock.calls[0][0].data;
    expect(data.file_name).toBe(name);
    expect(data.file_name).not.toContain("%");
  });
});
