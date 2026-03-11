import { parseBuffer } from "music-metadata";

/**
 * Media duration parsers for Feishu file upload.
 *
 * Feishu's im.file.create API requires a `duration` (in ms) for audio and video
 * so that the player shows the correct length and enables seeking.
 *
 * Supported containers:
 *   - OGG  (Opus / Vorbis)  — used by Feishu voice messages and most AI TTS output
 *   - MP4  (ISO base media) — MP4, MOV, QuickTime, M4A, M4V, 3GP share this format
 *   - WAV  (RIFF PCM)       — uncompressed audio
 *
 * Raw AAC / ADTS is delegated to music-metadata on the audio path.
 */

async function parseAudioDurationWithMusicMetadata(params: {
  buffer: Buffer;
  fileName?: string;
  contentType?: string;
}): Promise<number | undefined> {
  const { buffer, fileName, contentType } = params;
  try {
    const metadata = await parseBuffer(
      buffer,
      {
        mimeType: contentType,
        path: fileName,
        size: buffer.length,
      },
      {
        duration: true,
        skipCovers: true,
      },
    );
    const seconds = metadata.format.duration;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
      return undefined;
    }
    return Math.round(seconds * 1000);
  } catch {
    return undefined;
  }
}

/**
 * Parse duration from an OGG container (Opus or Vorbis).
 * Reads the granule position from the last OGG page and divides by sample rate.
 * Returns duration in milliseconds, or undefined if not OGG or parsing fails.
 */
export function parseOggDurationMs(buffer: Buffer): number | undefined {
  if (buffer.length < 27) return undefined;
  // Verify OGG capture pattern "OggS"
  if (buffer[0] !== 0x4f || buffer[1] !== 0x67 || buffer[2] !== 0x67 || buffer[3] !== 0x53) {
    return undefined;
  }

  // Detect codec and sample rate from identification header (scan first 4 KB)
  let sampleRate = 0;
  const searchLen = Math.min(buffer.length, 4096);
  for (let i = 0; i < searchLen - 8; i++) {
    // "OpusHead" — Opus always uses 48000 Hz for granule positions
    if (
      buffer[i] === 0x4f && buffer[i + 1] === 0x70 && buffer[i + 2] === 0x75 &&
      buffer[i + 3] === 0x73 && buffer[i + 4] === 0x48 && buffer[i + 5] === 0x65 &&
      buffer[i + 6] === 0x61 && buffer[i + 7] === 0x64
    ) {
      sampleRate = 48000;
      break;
    }
    // "\x01vorbis" — sample rate is uint32LE at +12 from start of tag
    if (
      buffer[i] === 0x01 && buffer[i + 1] === 0x76 && buffer[i + 2] === 0x6f &&
      buffer[i + 3] === 0x72 && buffer[i + 4] === 0x62 && buffer[i + 5] === 0x69 &&
      buffer[i + 6] === 0x73
    ) {
      if (i + 16 <= buffer.length) sampleRate = buffer.readUInt32LE(i + 12);
      break;
    }
  }
  if (sampleRate === 0) return undefined;

  // Scan all OGG pages to find the highest valid granule position
  let lastGranule = 0;
  let offset = 0;
  while (offset + 27 <= buffer.length) {
    if (
      buffer[offset] !== 0x4f || buffer[offset + 1] !== 0x67 ||
      buffer[offset + 2] !== 0x67 || buffer[offset + 3] !== 0x53
    ) break;
    // Granule position: 8 bytes LE at offset+6; 0xFFFFFFFFFFFFFFFF means "no position"
    const lo = buffer.readUInt32LE(offset + 6);
    const hi = buffer.readUInt32LE(offset + 10);
    if (lo !== 0xffffffff || hi !== 0xffffffff) {
      const granule = hi * 0x100000000 + lo;
      if (granule > lastGranule) lastGranule = granule;
    }
    const numSegments = buffer.readUInt8(offset + 26);
    if (offset + 27 + numSegments > buffer.length) break;
    let pageDataSize = 0;
    for (let i = 0; i < numSegments; i++) pageDataSize += buffer.readUInt8(offset + 27 + i);
    offset += 27 + numSegments + pageDataSize;
  }

  if (lastGranule <= 0) return undefined;
  return Math.round((lastGranule / sampleRate) * 1000);
}

/**
 * Parse duration from an ISO base media file format container (MP4 / MOV / M4A / QuickTime / 3GP).
 * Reads the `mvhd` (movie header) box inside `moov`.
 * Returns duration in milliseconds, or undefined if the box is not found.
 */
export function parseMp4DurationMs(buffer: Buffer): number | undefined {
  // Find 'moov' box at the top level
  let offset = 0;
  let moovStart = -1;
  let moovEnd = -1;
  while (offset + 8 <= buffer.length) {
    const boxSize = buffer.readUInt32BE(offset);
    if (boxSize < 8) break;
    if (buffer.toString("ascii", offset + 4, offset + 8) === "moov") {
      moovStart = offset;
      moovEnd = Math.min(offset + boxSize, buffer.length);
      break;
    }
    offset += boxSize;
  }
  if (moovStart < 0) return undefined;

  // Find 'mvhd' inside 'moov'
  let inner = moovStart + 8;
  while (inner + 8 <= moovEnd) {
    const boxSize = buffer.readUInt32BE(inner);
    if (boxSize < 8) break;
    if (buffer.toString("ascii", inner + 4, inner + 8) === "mvhd") {
      const version = buffer.readUInt8(inner + 8);
      if (version === 0) {
        // creation(4) + modification(4) + timescale(4) + duration(4)
        if (inner + 28 > buffer.length) return undefined;
        const timeScale = buffer.readUInt32BE(inner + 20);
        const duration = buffer.readUInt32BE(inner + 24);
        if (timeScale === 0) return undefined;
        return Math.round((duration / timeScale) * 1000);
      } else if (version === 1) {
        // creation(8) + modification(8) + timescale(4) + duration(8)
        if (inner + 40 > buffer.length) return undefined;
        const timeScale = buffer.readUInt32BE(inner + 28);
        const durationHi = buffer.readUInt32BE(inner + 32);
        const durationLo = buffer.readUInt32BE(inner + 36);
        const duration = durationHi * 0x100000000 + durationLo;
        if (timeScale === 0) return undefined;
        return Math.round((duration / timeScale) * 1000);
      }
      return undefined;
    }
    inner += boxSize;
  }
  return undefined;
}

/**
 * Parse duration from a WAV (RIFF PCM) file.
 * Computes duration from the `data` chunk size and the byte rate in the `fmt ` chunk.
 * Returns duration in milliseconds, or undefined if not WAV or parsing fails.
 */
export function parseWavDurationMs(buffer: Buffer): number | undefined {
  if (buffer.length < 44) return undefined;
  if (buffer.toString("ascii", 0, 4) !== "RIFF") return undefined;
  if (buffer.toString("ascii", 8, 12) !== "WAVE") return undefined;

  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (chunkId === "fmt ") {
      // fmt chunk layout (from chunk start):
      //   +0  chunk id "fmt " (4)
      //   +4  chunk size (4)
      //   +8  audio format (2)
      //   +10 num channels (2)
      //   +12 sample rate (4)
      //   +16 byte rate (4)  ← what we need
      if (offset + 20 > buffer.length) return undefined;
      byteRate = buffer.readUInt32LE(offset + 16);
    } else if (chunkId === "data") {
      dataSize = chunkSize;
      break;
    }
    // Advance to next chunk; RIFF chunks are aligned to even byte boundaries
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  if (byteRate === 0 || dataSize === 0) return undefined;
  return Math.round((dataSize / byteRate) * 1000);
}

/**
 * Parse duration from a media buffer for Feishu upload.
 *
 * Routes to the appropriate parser based on Feishu's file type:
 *   - "mp4"  → MP4/MOV/QuickTime container parser
 *   - "opus" → music-metadata first, then OGG parser, then MP4 container, then WAV
 *
 * Returns duration in milliseconds, or undefined if not determinable.
 */
export async function parseFeishuMediaDurationMs(
  buffer: Buffer,
  fileType: "opus" | "mp4",
  options?: { fileName?: string; contentType?: string },
): Promise<number | undefined> {
  if (fileType === "mp4") {
    return parseMp4DurationMs(buffer);
  }
  return (
    await parseAudioDurationWithMusicMetadata({
      buffer,
      fileName: options?.fileName,
      contentType: options?.contentType,
    })
  ) ?? parseOggDurationMs(buffer) ?? parseMp4DurationMs(buffer) ?? parseWavDurationMs(buffer);
}
