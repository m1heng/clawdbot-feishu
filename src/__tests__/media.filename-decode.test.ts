import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveFeishuAccountMock = vi.hoisted(() => vi.fn());
const getFeishuRuntimeMock = vi.hoisted(() => vi.fn());
const createFeishuClientMock = vi.hoisted(() => vi.fn());

vi.mock("../accounts.js", () => ({ resolveFeishuAccount: resolveFeishuAccountMock }));
vi.mock("../runtime.js", () => ({ getFeishuRuntime: getFeishuRuntimeMock }));
vi.mock("../client.js", () => ({ createFeishuClient: createFeishuClientMock }));

import { sendMediaFeishu } from "../media.js";

describe("sendMediaFeishu filename URL-decoding", () => {
  const cfg = { channels: { feishu: { appId: "cli_test", appSecret: "sec_test" } } } as any;
  let fileCreateSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    resolveFeishuAccountMock.mockReturnValue({ configured: true, accountId: "default", config: {} });

    fileCreateSpy = vi.fn(async () => ({ code: 0, file_key: "fk_test" }));
    createFeishuClientMock.mockReturnValue({
      im: {
        file: { create: fileCreateSpy },
        message: { create: vi.fn(async () => ({ code: 0, data: { message_id: "om_test" } })) },
      },
    } as any);
  });

  function mockLoadWebMedia(fileName: string) {
    getFeishuRuntimeMock.mockReturnValue({
      media: {
        loadWebMedia: vi.fn(async () => ({
          buffer: Buffer.from("data"),
          fileName,
          contentType: "application/octet-stream",
        })),
      },
    });
  }

  it("decodes percent-encoded Chinese filename", async () => {
    mockLoadWebMedia("%E5%88%86%E6%8B%A3%E4%BD%9C%E4%B8%9A.xlsx");
    await sendMediaFeishu({ cfg, to: "oc_test", mediaUrl: "https://example.com/file.xlsx" });
    const data = fileCreateSpy.mock.calls[0][0].data;
    expect(data.file_name).toBe("分拣作业.xlsx");
  });

  it("keeps ASCII filename unchanged", async () => {
    mockLoadWebMedia("report.xlsx");
    await sendMediaFeishu({ cfg, to: "oc_test", mediaUrl: "https://example.com/report.xlsx" });
    const data = fileCreateSpy.mock.calls[0][0].data;
    expect(data.file_name).toBe("report.xlsx");
  });

  it("falls back to original when percent sequence is invalid", async () => {
    mockLoadWebMedia("report%ZZ.xlsx");
    await sendMediaFeishu({ cfg, to: "oc_test", mediaUrl: "https://example.com/report%ZZ.xlsx" });
    const data = fileCreateSpy.mock.calls[0][0].data;
    expect(data.file_name).toBe("report%ZZ.xlsx");
  });

  it("prefers caller-provided fileName over decoded loadWebMedia name", async () => {
    mockLoadWebMedia("%E5%88%86%E6%8B%A3.xlsx");
    await sendMediaFeishu({ cfg, to: "oc_test", mediaUrl: "https://example.com/file.xlsx", fileName: "custom.xlsx" });
    const data = fileCreateSpy.mock.calls[0][0].data;
    expect(data.file_name).toBe("custom.xlsx");
  });
});
