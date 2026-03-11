import { describe, expect, it } from "vitest";
import {
  parseOggDurationMs,
  parseMp4DurationMs,
  parseWavDurationMs,
  parseFeishuMediaDurationMs,
} from "../media-duration.js";

// ---------------------------------------------------------------------------
// Helpers to build minimal synthetic media buffers
// ---------------------------------------------------------------------------

/** Build a single OGG page. CRC is left as zero (not verified by the parser). */
function makeOggPage(
  granule: bigint,
  serial: number,
  sequence: number,
  data: Buffer,
  headerType: number,
): Buffer {
  const segments: number[] = [];
  if (data.length === 0) {
    segments.push(0);
  } else {
    let remaining = data.length;
    while (remaining > 0) {
      const seg = Math.min(255, remaining);
      segments.push(seg);
      remaining -= seg;
      if (seg < 255) break;
    }
  }
  const headerSize = 27 + segments.length;
  const buf = Buffer.alloc(headerSize + data.length);
  buf.write("OggS", 0, "ascii");
  buf.writeUInt8(0, 4);
  buf.writeUInt8(headerType, 5);
  buf.writeUInt32LE(Number(granule & 0xffff_ffffn), 6);
  buf.writeUInt32LE(Number((granule >> 32n) & 0xffff_ffffn), 10);
  buf.writeUInt32LE(serial, 14);
  buf.writeUInt32LE(sequence, 18);
  buf.writeUInt32LE(0, 22); // CRC
  buf.writeUInt8(segments.length, 26);
  segments.forEach((s, i) => buf.writeUInt8(s, 27 + i));
  data.copy(buf, headerSize);
  return buf;
}

/** Build a minimal OGG/Opus buffer with the given granule position (samples at 48000 Hz). */
function makeOpusBuffer(granuleSamples: number): Buffer {
  // Opus identification header (19 bytes)
  const opusHead = Buffer.from([
    0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, // "OpusHead"
    0x01, 0x01, // version=1, channels=1
    0x38, 0x01, // pre-skip=312 LE
    0x80, 0xbb, 0x00, 0x00, // input_sample_rate=48000 LE
    0x00, 0x00, 0x00, // output_gain=0, channel_mapping=0
  ]);
  const page1 = makeOggPage(0xffff_ffff_ffff_ffffn, 1, 0, opusHead, 0x02);
  const page2 = makeOggPage(BigInt(granuleSamples), 1, 1, Buffer.alloc(0), 0x04);
  return Buffer.concat([page1, page2]);
}

/** Build a minimal OGG/Vorbis buffer with the given granule position and sample rate. */
function makeVorbisBuffer(granuleSamples: number, sampleRate: number): Buffer {
  // Vorbis identification header (minimum 16 bytes needed for the parser)
  const vorbisHead = Buffer.alloc(16);
  vorbisHead.writeUInt8(0x01, 0); // packet type = identification
  vorbisHead.write("vorbis", 1, "ascii");
  // vorbis_version at offset 7 (4 bytes) = 0
  vorbisHead.writeUInt8(1, 11); // audio_channels
  vorbisHead.writeUInt32LE(sampleRate, 12); // audio_sample_rate
  const page1 = makeOggPage(0xffff_ffff_ffff_ffffn, 1, 0, vorbisHead, 0x02);
  const page2 = makeOggPage(BigInt(granuleSamples), 1, 1, Buffer.alloc(0), 0x04);
  return Buffer.concat([page1, page2]);
}

/** Build a minimal MP4 buffer with a moov/mvhd box (version 0). */
function makeMp4Buffer(timescale: number, duration: number): Buffer {
  // mvhd v0: 4(size)+4(type)+1(ver)+3(flags)+4(ctime)+4(mtime)+4(tscale)+4(dur) = 28 bytes
  const mvhdSize = 28;
  const moovSize = 8 + mvhdSize;
  const buf = Buffer.alloc(moovSize);
  buf.writeUInt32BE(moovSize, 0);
  buf.write("moov", 4, "ascii");
  buf.writeUInt32BE(mvhdSize, 8);
  buf.write("mvhd", 12, "ascii");
  buf.writeUInt8(0, 16); // version = 0
  // flags [17..19] = 0
  // creation_time [20..23] = 0
  // modification_time [24..27] = 0
  buf.writeUInt32BE(timescale, 28);
  buf.writeUInt32BE(duration, 32);
  return buf;
}

/** Build a minimal MP4 buffer with a moov/mvhd box (version 1, 64-bit durations). */
function makeMp4v1Buffer(timescale: number, duration: number): Buffer {
  // mvhd v1: 4(size)+4(type)+1(ver)+3(flags)+8(ctime)+8(mtime)+4(tscale)+8(dur) = 40 bytes
  const mvhdSize = 40;
  const moovSize = 8 + mvhdSize;
  const buf = Buffer.alloc(moovSize);
  buf.writeUInt32BE(moovSize, 0);
  buf.write("moov", 4, "ascii");
  buf.writeUInt32BE(mvhdSize, 8);
  buf.write("mvhd", 12, "ascii");
  buf.writeUInt8(1, 16); // version = 1
  // flags [17..19] = 0
  // creation_time [20..27] = 0 (8 bytes)
  // modification_time [28..35] = 0 (8 bytes)
  buf.writeUInt32BE(timescale, 36);
  buf.writeUInt32BE(0, 40); // durationHi
  buf.writeUInt32BE(duration, 44); // durationLo
  return buf;
}

/** Build a minimal WAV (PCM) buffer. dataBytes is the number of audio data bytes. */
function makeWavBuffer(sampleRate: number, channels: number, dataBytes: number): Buffer {
  const byteRate = sampleRate * channels * 2; // 16-bit samples
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(channels * 2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);
  return buf;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseOggDurationMs", () => {
  it("returns undefined for empty / non-OGG buffers", () => {
    expect(parseOggDurationMs(Buffer.alloc(0))).toBeUndefined();
    expect(parseOggDurationMs(Buffer.from("RIFF"))).toBeUndefined();
    expect(parseOggDurationMs(Buffer.alloc(100))).toBeUndefined();
  });

  it("parses Opus duration (48000 Hz granule clock)", () => {
    // 5 seconds = 48000 * 5 = 240000 samples
    expect(parseOggDurationMs(makeOpusBuffer(240000))).toBe(5000);
    // 1.5 seconds = 72000 samples → 1500ms
    expect(parseOggDurationMs(makeOpusBuffer(72000))).toBe(1500);
  });

  it("parses Vorbis duration using stream sample rate", () => {
    // 3 seconds at 44100 Hz = 132300 samples
    expect(parseOggDurationMs(makeVorbisBuffer(132300, 44100))).toBe(3000);
    // 2 seconds at 22050 Hz = 44100 samples
    expect(parseOggDurationMs(makeVorbisBuffer(44100, 22050))).toBe(2000);
  });

  it("returns undefined when no valid granule position found", () => {
    // Page with only -1 granule (no audio data)
    const opusHead = Buffer.from([
      0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64,
      0x01, 0x01, 0x38, 0x01, 0x80, 0xbb, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    const onlyIdPage = makeOggPage(0xffff_ffff_ffff_ffffn, 1, 0, opusHead, 0x02);
    expect(parseOggDurationMs(onlyIdPage)).toBeUndefined();
  });
});

describe("parseMp4DurationMs", () => {
  it("returns undefined for empty / non-MP4 buffers", () => {
    expect(parseMp4DurationMs(Buffer.alloc(0))).toBeUndefined();
    expect(parseMp4DurationMs(Buffer.from("OggS"))).toBeUndefined();
    expect(parseMp4DurationMs(Buffer.alloc(100))).toBeUndefined();
  });

  it("parses mvhd version 0 duration", () => {
    // timescale=1000, duration=5000 → 5000ms
    expect(parseMp4DurationMs(makeMp4Buffer(1000, 5000))).toBe(5000);
    // timescale=90000, duration=270000 → 3000ms
    expect(parseMp4DurationMs(makeMp4Buffer(90000, 270000))).toBe(3000);
  });

  it("parses mvhd version 1 duration", () => {
    // timescale=1000, duration=7500 → 7500ms
    expect(parseMp4DurationMs(makeMp4v1Buffer(1000, 7500))).toBe(7500);
  });

  it("returns undefined when timescale is zero", () => {
    expect(parseMp4DurationMs(makeMp4Buffer(0, 5000))).toBeUndefined();
  });

  it("skips non-moov top-level boxes before finding moov", () => {
    // Prepend a 'free' box before the moov box
    const freeBox = Buffer.alloc(16);
    freeBox.writeUInt32BE(16, 0);
    freeBox.write("free", 4, "ascii");
    const moovBuf = makeMp4Buffer(1000, 2000);
    const combined = Buffer.concat([freeBox, moovBuf]);
    expect(parseMp4DurationMs(combined)).toBe(2000);
  });
});

describe("parseWavDurationMs", () => {
  it("returns undefined for empty / non-WAV buffers", () => {
    expect(parseWavDurationMs(Buffer.alloc(0))).toBeUndefined();
    expect(parseWavDurationMs(Buffer.from("OggS"))).toBeUndefined();
    expect(parseWavDurationMs(Buffer.alloc(43))).toBeUndefined(); // too short
  });

  it("parses mono 16-bit PCM duration", () => {
    // 44100 Hz mono 16-bit: byteRate = 88200; 1 second = 88200 bytes
    expect(parseWavDurationMs(makeWavBuffer(44100, 1, 88200))).toBe(1000);
    // 2.5 seconds
    expect(parseWavDurationMs(makeWavBuffer(44100, 1, 88200 * 2.5))).toBe(2500);
  });

  it("parses stereo 16-bit PCM duration", () => {
    // 48000 Hz stereo 16-bit: byteRate = 192000; 3 seconds = 576000 bytes
    expect(parseWavDurationMs(makeWavBuffer(48000, 2, 576000))).toBe(3000);
  });
});

describe("parseFeishuMediaDurationMs", () => {
  it("routes 'mp4' to the MP4 parser", async () => {
    await expect(parseFeishuMediaDurationMs(makeMp4Buffer(1000, 4000), "mp4")).resolves.toBe(4000);
    await expect(parseFeishuMediaDurationMs(makeOpusBuffer(48000), "mp4")).resolves.toBeUndefined();
  });

  it("routes 'opus' to OGG parser path", async () => {
    await expect(parseFeishuMediaDurationMs(makeOpusBuffer(96000), "opus")).resolves.toBeCloseTo(1994, 0);
  });

  it("falls back to MP4 parser for M4A (opus type, MP4 container)", async () => {
    const m4aLike = makeMp4Buffer(44100, 132300); // ~3000ms
    await expect(parseFeishuMediaDurationMs(m4aLike, "opus")).resolves.toBe(3000);
  });

  it("falls back to WAV parser for opus type", async () => {
    const wav = makeWavBuffer(44100, 1, 44100 * 2); // 1000ms
    await expect(parseFeishuMediaDurationMs(wav, "opus")).resolves.toBe(1000);
  });

  it("uses music-metadata for MP3 audio", async () => {
    // Minimal valid MP3 frame sequence with Xing header. Real duration is ~235 ms.
    const mp3 = Buffer.from(
      "SUQzAwAAAAAAFlRTU0UAAAAPAAADTGF2ZjU5LjI3LjEwMAAAAAAAAAAAAAAA//tAwAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAJAAAZcwAICA8PFBQZGR4eIyMoKC0tMjI3Nzw8QUFGRktLVFBQVVVZWV5eY2NoaG1tcnJ3d3x8gYGGhoqKj4+UlJmZnZ2ioqenp6ysrbGxtbW6ur6+w8PHx8zM0dDR0dXV2tra39/k5Ojo7e3y8vLy9/f7+/8AAAAATGF2YzU5LjM3AAAAAAAAAAAAAAAAJAX/4CPAAAAAADTLyV6eAAAAAAAAAAAAAAAAAAAAAP/7EMQAAANIAAAAAExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+xDEAAPAAAGkAAAAIAAANIAAAAAExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+xDEAA8AAAZAAAAAgAA0ygAAAARMYXZmNTkuMjcuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/7EMQADwAABkAAAAIAANIAAAABTGF2YzU5LjM3VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+xDEAA8AAAZAAAAAgAA0ygAAAA==",
      "base64",
    );
    await expect(
      parseFeishuMediaDurationMs(mp3, "opus", { fileName: "sample.mp3", contentType: "audio/mpeg" }),
    ).resolves.toBe(235);
  });

  it("returns undefined when no parser recognizes the buffer", async () => {
    await expect(parseFeishuMediaDurationMs(Buffer.alloc(100), "opus")).resolves.toBeUndefined();
    await expect(parseFeishuMediaDurationMs(Buffer.alloc(100), "mp4")).resolves.toBeUndefined();
  });
});
