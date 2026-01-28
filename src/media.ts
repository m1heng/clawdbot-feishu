import type { ClawdbotConfig } from "clawdbot/plugin-sdk";
import type { FeishuConfig } from "./types.js";
import { createFeishuClient } from "./client.js";
import { resolveReceiveIdType, normalizeFeishuTarget } from "./targets.js";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import os from "os";

export type UploadImageResult = {
  imageKey: string;
};

export type UploadFileResult = {
  fileKey: string;
};

export type SendMediaResult = {
  messageId: string;
  chatId: string;
};

export type DownloadResult = {
  filePath: string;
  fileName: string;
  size: number;
};

/**
 * Get the download directory for Feishu media files.
 * Creates the directory if it doesn't exist.
 */
export function getFeishuDownloadDir(cfg?: ClawdbotConfig): string {
  const feishuCfg = cfg?.channels?.feishu as FeishuConfig | undefined;
  const baseDir = feishuCfg?.downloadDir || process.env.CLAWD_WORKSPACE || os.homedir();
  const downloadDir = path.join(baseDir, "downloads", "feishu");
  
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }
  
  return downloadDir;
}

/**
 * Download an image from Feishu and save to local file.
 * Returns the absolute file path for AI to read.
 * 
 * Note: This is for standalone image messages (message_type=image).
 * For images embedded in rich text (post), use downloadMessageResourceFeishu instead.
 */
export async function downloadImageFeishu(params: {
  cfg: ClawdbotConfig;
  imageKey: string;
}): Promise<DownloadResult> {
  const { cfg, imageKey } = params;
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg) {
    throw new Error("Feishu channel not configured");
  }

  const client = createFeishuClient(feishuCfg);
  
  const response = await client.im.image.get({
    path: { image_key: imageKey },
  });

  // Response is a readable stream
  const chunks: Buffer[] = [];
  const stream = response as unknown as Readable;
  
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  
  const buffer = Buffer.concat(chunks);
  const downloadDir = getFeishuDownloadDir(cfg);
  const fileName = `${Date.now()}_${imageKey}.png`;
  const filePath = path.join(downloadDir, fileName);
  
  await fs.promises.writeFile(filePath, buffer);
  
  return {
    filePath,
    fileName,
    size: buffer.length,
  };
}

/**
 * Download a resource (image/file) embedded in a message.
 * This is used for images in rich text (post) messages.
 * Uses the message resource API: GET /im/v1/messages/{message_id}/resources/{file_key}
 */
export async function downloadMessageResourceFeishu(params: {
  cfg: ClawdbotConfig;
  messageId: string;
  fileKey: string;
  resourceType?: "image" | "file";
}): Promise<DownloadResult> {
  const { cfg, messageId, fileKey, resourceType = "image" } = params;
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg) {
    throw new Error("Feishu channel not configured");
  }

  const client = createFeishuClient(feishuCfg);
  
  const response = await client.im.messageResource.get({
    path: { 
      message_id: messageId, 
      file_key: fileKey,
    },
    params: { type: resourceType },
  });

  // SDK response has writeFile and getReadableStream methods
  const responseAny = response as any;
  const downloadDir = getFeishuDownloadDir(cfg);
  const ext = resourceType === "image" ? "png" : "bin";
  const fileName = `${Date.now()}_${fileKey}.${ext}`;
  const filePath = path.join(downloadDir, fileName);
  
  if (typeof responseAny.writeFile === "function") {
    // Use SDK's writeFile method directly
    await responseAny.writeFile(filePath);
    const stats = await fs.promises.stat(filePath);
    return {
      filePath,
      fileName,
      size: stats.size,
    };
  } else if (typeof responseAny.getReadableStream === "function") {
    // Use getReadableStream and pipe to file
    const stream = responseAny.getReadableStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    await fs.promises.writeFile(filePath, buffer);
    return {
      filePath,
      fileName,
      size: buffer.length,
    };
  } else {
    throw new Error("Unexpected response format from Feishu API");
  }
}

/**
 * Download a file from Feishu message and save to local file.
 * Returns the absolute file path for AI to read.
 */
export async function downloadFileFeishu(params: {
  cfg: ClawdbotConfig;
  messageId: string;
  fileKey: string;
  fileName?: string;
}): Promise<DownloadResult> {
  const { cfg, messageId, fileKey, fileName: originalName } = params;
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg) {
    throw new Error("Feishu channel not configured");
  }

  const client = createFeishuClient(feishuCfg);
  
  const response = await client.im.messageResource.get({
    path: { 
      message_id: messageId, 
      file_key: fileKey,
    },
    params: { type: "file" },
  });

  // SDK response has writeFile and getReadableStream methods
  const responseAny = response as any;
  const downloadDir = getFeishuDownloadDir(cfg);
  const fileName = originalName 
    ? `${Date.now()}_${originalName}` 
    : `${Date.now()}_${fileKey}`;
  const filePath = path.join(downloadDir, fileName);
  
  if (typeof responseAny.writeFile === "function") {
    // Use SDK's writeFile method directly
    await responseAny.writeFile(filePath);
    const stats = await fs.promises.stat(filePath);
    return {
      filePath,
      fileName,
      size: stats.size,
    };
  } else if (typeof responseAny.getReadableStream === "function") {
    // Use getReadableStream and pipe to file
    const stream = responseAny.getReadableStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    await fs.promises.writeFile(filePath, buffer);
    return {
      filePath,
      fileName,
      size: buffer.length,
    };
  } else {
    throw new Error("Unexpected response format from Feishu API");
  }
}

/**
 * Download audio from Feishu message and save to local file.
 */
export async function downloadAudioFeishu(params: {
  cfg: ClawdbotConfig;
  messageId: string;
  fileKey: string;
}): Promise<DownloadResult> {
  const { cfg, messageId, fileKey } = params;
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg) {
    throw new Error("Feishu channel not configured");
  }

  const client = createFeishuClient(feishuCfg);
  
  const response = await client.im.messageResource.get({
    path: { 
      message_id: messageId, 
      file_key: fileKey,
    },
    params: { type: "file" },
  });

  // SDK response has writeFile and getReadableStream methods
  const responseAny = response as any;
  const downloadDir = getFeishuDownloadDir(cfg);
  const fileName = `${Date.now()}_${fileKey}.opus`;
  const filePath = path.join(downloadDir, fileName);
  
  if (typeof responseAny.writeFile === "function") {
    await responseAny.writeFile(filePath);
    const stats = await fs.promises.stat(filePath);
    return {
      filePath,
      fileName,
      size: stats.size,
    };
  } else if (typeof responseAny.getReadableStream === "function") {
    const stream = responseAny.getReadableStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    await fs.promises.writeFile(filePath, buffer);
    return {
      filePath,
      fileName,
      size: buffer.length,
    };
  } else {
    throw new Error("Unexpected response format from Feishu API");
  }
}

/**
 * Upload an image to Feishu and get an image_key for sending.
 * Supports: JPEG, PNG, WEBP, GIF, TIFF, BMP, ICO
 */
export async function uploadImageFeishu(params: {
  cfg: ClawdbotConfig;
  image: Buffer | string; // Buffer or file path
  imageType?: "message" | "avatar";
}): Promise<UploadImageResult> {
  const { cfg, image, imageType = "message" } = params;
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg) {
    throw new Error("Feishu channel not configured");
  }

  const client = createFeishuClient(feishuCfg);

  // SDK expects a Readable stream, not a Buffer
  // Use type assertion since SDK actually accepts any Readable at runtime
  const imageStream =
    typeof image === "string" ? fs.createReadStream(image) : Readable.from(image);

  const response = await client.im.image.create({
    data: {
      image_type: imageType,
      image: imageStream as any,
    },
  });

  // SDK v1.30+ returns data directly without code wrapper on success
  // On error, it throws or returns { code, msg }
  const responseAny = response as any;
  if (responseAny.code !== undefined && responseAny.code !== 0) {
    throw new Error(`Feishu image upload failed: ${responseAny.msg || `code ${responseAny.code}`}`);
  }

  const imageKey = responseAny.image_key ?? responseAny.data?.image_key;
  if (!imageKey) {
    throw new Error("Feishu image upload failed: no image_key returned");
  }

  return { imageKey };
}

/**
 * Upload a file to Feishu and get a file_key for sending.
 * Max file size: 30MB
 */
export async function uploadFileFeishu(params: {
  cfg: ClawdbotConfig;
  file: Buffer | string; // Buffer or file path
  fileName: string;
  fileType: "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream";
  duration?: number; // Required for audio/video files, in milliseconds
}): Promise<UploadFileResult> {
  const { cfg, file, fileName, fileType, duration } = params;
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg) {
    throw new Error("Feishu channel not configured");
  }

  const client = createFeishuClient(feishuCfg);

  // SDK expects a Readable stream, not a Buffer
  // Use type assertion since SDK actually accepts any Readable at runtime
  const fileStream =
    typeof file === "string" ? fs.createReadStream(file) : Readable.from(file);

  const response = await client.im.file.create({
    data: {
      file_type: fileType,
      file_name: fileName,
      file: fileStream as any,
      ...(duration !== undefined && { duration }),
    },
  });

  // SDK v1.30+ returns data directly without code wrapper on success
  const responseAny = response as any;
  if (responseAny.code !== undefined && responseAny.code !== 0) {
    throw new Error(`Feishu file upload failed: ${responseAny.msg || `code ${responseAny.code}`}`);
  }

  const fileKey = responseAny.file_key ?? responseAny.data?.file_key;
  if (!fileKey) {
    throw new Error("Feishu file upload failed: no file_key returned");
  }

  return { fileKey };
}

/**
 * Send an image message using an image_key
 */
export async function sendImageFeishu(params: {
  cfg: ClawdbotConfig;
  to: string;
  imageKey: string;
  replyToMessageId?: string;
}): Promise<SendMediaResult> {
  const { cfg, to, imageKey, replyToMessageId } = params;
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg) {
    throw new Error("Feishu channel not configured");
  }

  const client = createFeishuClient(feishuCfg);
  const receiveId = normalizeFeishuTarget(to);
  if (!receiveId) {
    throw new Error(`Invalid Feishu target: ${to}`);
  }

  const receiveIdType = resolveReceiveIdType(receiveId);
  const content = JSON.stringify({ image_key: imageKey });

  if (replyToMessageId) {
    const response = await client.im.message.reply({
      path: { message_id: replyToMessageId },
      data: {
        content,
        msg_type: "image",
      },
    });

    if (response.code !== 0) {
      throw new Error(`Feishu image reply failed: ${response.msg || `code ${response.code}`}`);
    }

    return {
      messageId: response.data?.message_id ?? "unknown",
      chatId: receiveId,
    };
  }

  const response = await client.im.message.create({
    params: { receive_id_type: receiveIdType },
    data: {
      receive_id: receiveId,
      content,
      msg_type: "image",
    },
  });

  if (response.code !== 0) {
    throw new Error(`Feishu image send failed: ${response.msg || `code ${response.code}`}`);
  }

  return {
    messageId: response.data?.message_id ?? "unknown",
    chatId: receiveId,
  };
}

/**
 * Send a file message using a file_key
 */
export async function sendFileFeishu(params: {
  cfg: ClawdbotConfig;
  to: string;
  fileKey: string;
  replyToMessageId?: string;
}): Promise<SendMediaResult> {
  const { cfg, to, fileKey, replyToMessageId } = params;
  const feishuCfg = cfg.channels?.feishu as FeishuConfig | undefined;
  if (!feishuCfg) {
    throw new Error("Feishu channel not configured");
  }

  const client = createFeishuClient(feishuCfg);
  const receiveId = normalizeFeishuTarget(to);
  if (!receiveId) {
    throw new Error(`Invalid Feishu target: ${to}`);
  }

  const receiveIdType = resolveReceiveIdType(receiveId);
  const content = JSON.stringify({ file_key: fileKey });

  if (replyToMessageId) {
    const response = await client.im.message.reply({
      path: { message_id: replyToMessageId },
      data: {
        content,
        msg_type: "file",
      },
    });

    if (response.code !== 0) {
      throw new Error(`Feishu file reply failed: ${response.msg || `code ${response.code}`}`);
    }

    return {
      messageId: response.data?.message_id ?? "unknown",
      chatId: receiveId,
    };
  }

  const response = await client.im.message.create({
    params: { receive_id_type: receiveIdType },
    data: {
      receive_id: receiveId,
      content,
      msg_type: "file",
    },
  });

  if (response.code !== 0) {
    throw new Error(`Feishu file send failed: ${response.msg || `code ${response.code}`}`);
  }

  return {
    messageId: response.data?.message_id ?? "unknown",
    chatId: receiveId,
  };
}

/**
 * Helper to detect file type from extension
 */
export function detectFileType(
  fileName: string,
): "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream" {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case ".opus":
    case ".ogg":
      return "opus";
    case ".mp4":
    case ".mov":
    case ".avi":
      return "mp4";
    case ".pdf":
      return "pdf";
    case ".doc":
    case ".docx":
      return "doc";
    case ".xls":
    case ".xlsx":
      return "xls";
    case ".ppt":
    case ".pptx":
      return "ppt";
    default:
      return "stream";
  }
}

/**
 * Check if a string is a local file path (not a URL)
 */
function isLocalPath(urlOrPath: string): boolean {
  // Starts with / or ~ or drive letter (Windows)
  if (urlOrPath.startsWith("/") || urlOrPath.startsWith("~") || /^[a-zA-Z]:/.test(urlOrPath)) {
    return true;
  }
  // Try to parse as URL - if it fails or has no protocol, it's likely a local path
  try {
    const url = new URL(urlOrPath);
    return url.protocol === "file:";
  } catch {
    return true; // Not a valid URL, treat as local path
  }
}

/**
 * Upload and send media (image or file) from URL, local path, or buffer
 */
export async function sendMediaFeishu(params: {
  cfg: ClawdbotConfig;
  to: string;
  mediaUrl?: string;
  mediaBuffer?: Buffer;
  fileName?: string;
  replyToMessageId?: string;
}): Promise<SendMediaResult> {
  const { cfg, to, mediaUrl, mediaBuffer, fileName, replyToMessageId } = params;

  let buffer: Buffer;
  let name: string;

  if (mediaBuffer) {
    buffer = mediaBuffer;
    name = fileName ?? "file";
  } else if (mediaUrl) {
    if (isLocalPath(mediaUrl)) {
      // Local file path - read directly
      const filePath = mediaUrl.startsWith("~")
        ? mediaUrl.replace("~", process.env.HOME ?? "")
        : mediaUrl.replace("file://", "");

      if (!fs.existsSync(filePath)) {
        throw new Error(`Local file not found: ${filePath}`);
      }
      buffer = fs.readFileSync(filePath);
      name = fileName ?? path.basename(filePath);
    } else {
      // Remote URL - fetch
      const response = await fetch(mediaUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch media from URL: ${response.status}`);
      }
      buffer = Buffer.from(await response.arrayBuffer());
      name = fileName ?? (path.basename(new URL(mediaUrl).pathname) || "file");
    }
  } else {
    throw new Error("Either mediaUrl or mediaBuffer must be provided");
  }

  // Determine if it's an image based on extension
  const ext = path.extname(name).toLowerCase();
  const isImage = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".ico", ".tiff"].includes(ext);

  if (isImage) {
    const { imageKey } = await uploadImageFeishu({ cfg, image: buffer });
    return sendImageFeishu({ cfg, to, imageKey, replyToMessageId });
  } else {
    const fileType = detectFileType(name);
    const { fileKey } = await uploadFileFeishu({
      cfg,
      file: buffer,
      fileName: name,
      fileType,
    });
    return sendFileFeishu({ cfg, to, fileKey, replyToMessageId });
  }
}
