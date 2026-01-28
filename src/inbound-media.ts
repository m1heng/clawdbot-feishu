import type { ClawdbotConfig, RuntimeEnv } from "clawdbot/plugin-sdk";
import type { Readable } from "stream";
import type { FeishuConfig } from "./types.js";
import { createFeishuClient } from "./client.js";
import { getFeishuRuntime } from "./runtime.js";

export type InboundImageResult = {
  path: string;
  contentType?: string;
};

const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024; // 1GB cap: effectively "no limit" for normal images, still prevents runaway memory.

function parseImageKeyFromContent(content: string): string | undefined {
  try {
    const parsed = JSON.parse(content);
    const key = parsed?.image_key ?? parsed?.imageKey;
    return typeof key === "string" && key.trim() ? key : undefined;
  } catch {
    return undefined;
  }
}

function headerGet(headers: Record<string, any> | undefined, key: string): string | undefined {
  if (!headers) return undefined;
  const direct = headers[key];
  if (typeof direct === "string") return direct;
  const lower = headers[key.toLowerCase()];
  if (typeof lower === "string") return lower;
  const upper = headers[key.toUpperCase()];
  if (typeof upper === "string") return upper;
  return undefined;
}

async function readableToBuffer(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      throw new Error(`Inbound media exceeded maxBytes (${maxBytes})`);
    }
    chunks.push(buf);
  }

  return Buffer.concat(chunks, total);
}

/**
 * Download a user-sent image from a Feishu message and store it using Clawdbot's inbound media cache.
 *
 * Uses messageResource.get (im/v1/messages/:message_id/resources/:file_key) which supports user-sent media.
 */
export async function downloadInboundImageFromFeishuMessage(params: {
  cfg: ClawdbotConfig;
  feishuCfg: FeishuConfig;
  messageId: string;
  messageContent: string;
  runtime?: RuntimeEnv;
  maxBytes?: number;
}): Promise<InboundImageResult | null> {
  const { cfg, feishuCfg, messageId, messageContent, runtime, maxBytes = DEFAULT_MAX_BYTES } = params;

  const imageKey = parseImageKeyFromContent(messageContent);
  if (!imageKey) return null;

  const log = runtime?.log ?? console.log;
  const error = runtime?.error ?? console.error;

  const client = createFeishuClient(feishuCfg);

  try {
    const res = await client.im.messageResource.get({
      params: {
        type: "image",
      },
      path: {
        message_id: messageId,
        file_key: imageKey,
      },
    });

    const contentType = headerGet(res.headers as any, "content-type") ?? "image/jpeg";
    const stream = res.getReadableStream();
    const buffer = await readableToBuffer(stream as any, maxBytes);

    const core = getFeishuRuntime();
    const saved = await core.channel.media.saveMediaBuffer(buffer, contentType, "inbound", maxBytes);

    log(`feishu: downloaded inbound image (bytes=${buffer.length}) -> ${saved.path}`);

    return {
      path: saved.path,
      contentType: saved.contentType ?? contentType,
    };
  } catch (err) {
    error(`feishu: failed to download inbound image for message ${messageId}: ${String(err)}`);
    return null;
  }
}
