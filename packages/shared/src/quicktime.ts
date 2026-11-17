// Reading an L3, OTSL or OTSR graphic's format in the browser, before it's uploaded (RG, Nov 17, 2026): the
// right one is 1920×1080, 29.97 frames a second, Apple ProRes 4444 with alpha, in a QuickTime .mov. A
// QuickTime file keeps those details in a small index (its "moov" box), so only that is read, not the
// whole file. A graphic in any other format is converted on GitHub's machines after it's uploaded.

/** The element types whose graphics must be in the right format. */
export const FORMAT_CHECKED_TYPES = ['L3', 'OTSL', 'OTSR'] as const;

export function isFormatChecked(type: string): boolean {
  return (FORMAT_CHECKED_TYPES as readonly string[]).includes(type);
}

export interface VideoFormat {
  /** The codec's four-letter code: "ap4h" is ProRes 4444, "avc1" H.264. */
  codec: string;
  width: number;
  height: number;
  /** Frames a second, like 29.97. */
  fps: number | null;
  /** Bits per pixel: 32 when the picture has an alpha channel. */
  depth: number;
}

/** Reads bytes start to end (not included) of the file. */
export type ReadBytes = (start: number, end: number) => Promise<Uint8Array>;

const text = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
const u16 = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const u32 = (b: Uint8Array, at: number) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
const u64 = (b: Uint8Array, at: number) => u32(b, at) * 2 ** 32 + u32(b, at + 4);

interface Box {
  type: string;
  /** Where its contents start and end, in the bytes given. */
  start: number;
  end: number;
}

/** The boxes inside bytes from start to end. */
function boxes(b: Uint8Array, start = 0, end = b.length): Box[] {
  const found: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    let size = u32(b, at);
    let header = 8;
    if (size === 1) {
      size = u64(b, at + 8);
      header = 16;
    } else if (size === 0) size = end - at;
    if (size < header || at + size > end) break;
    found.push({ type: text(b, at + 4), start: at + header, end: at + size });
    at += size;
  }
  return found;
}

const child = (b: Uint8Array, box: Box | undefined, type: string) => (box ? boxes(b, box.start, box.end).find((x) => x.type === type) : undefined);

/** The file's "moov" box, found by walking the top-level boxes, which may come after the picture data. */
async function readMoov(read: ReadBytes, size: number): Promise<Uint8Array | null> {
  let at = 0;
  while (at + 8 <= size) {
    const head = await read(at, Math.min(at + 16, size));
    let length = u32(head, 0);
    if (length === 1 && head.length >= 16) length = u64(head, 8);
    else if (length === 0) length = size - at;
    if (length < 8) return null;
    if (text(head, 4) === 'moov') return length > 64 * 1024 * 1024 ? null : read(at, at + length);
    at += length;
  }
  return null;
}

/** The video track's format, or null when it isn't a QuickTime or MP4 file with one. */
export async function readVideoFormat(read: ReadBytes, size: number): Promise<VideoFormat | null> {
  const moov = await readMoov(read, size);
  if (!moov) return null;
  const root = boxes(moov)[0];
  for (const trak of boxes(moov, root.start, root.end).filter((x) => x.type === 'trak')) {
    const mdia = child(moov, trak, 'mdia');
    const hdlr = child(moov, mdia, 'hdlr');
    if (!hdlr || text(moov, hdlr.start + 8) !== 'vide') continue;
    const mdhd = child(moov, mdia, 'mdhd');
    const stbl = child(moov, child(moov, mdia, 'minf'), 'stbl');
    const stsd = child(moov, stbl, 'stsd');
    if (!mdhd || !stsd) continue;
    const timescale = moov[mdhd.start] === 1 ? u32(moov, mdhd.start + 20) : u32(moov, mdhd.start + 12);
    // The first sample description: its four-letter code, then (after 78 bytes) width, height and depth.
    const entry = stsd.start + 8;
    const codec = text(moov, entry + 4);
    const width = u16(moov, entry + 32);
    const height = u16(moov, entry + 34);
    const depth = u16(moov, entry + 82);
    // Frames a second: the time scale over each frame's length, from the first run of frames.
    const stts = child(moov, stbl, 'stts');
    const delta = stts && u32(moov, stts.start + 4) > 0 ? u32(moov, stts.start + 12) : 0;
    const fps = timescale && delta ? Math.round((timescale / delta) * 100) / 100 : null;
    return { codec, width, height, fps, depth };
  }
  return null;
}

/**
 * What's wrong with a graphic's format, in words the producer knows, or nothing when it's exactly right.
 * format is what readVideoFormat found (null: not a video it could read, like a still picture).
 */
export function graphicFormatProblems(fileName: string, format: VideoFormat | null): string[] {
  const ext = (/\.[^.]+$/.exec(fileName)?.[0] ?? '').toLowerCase();
  const problems: string[] = [];
  if (!format) {
    if (/^\.(png|jpe?g|tiff?|gif|bmp|webp)$/.test(ext)) return ['it’s a still picture, not a clip'];
    return [ext === '.mov' ? 'its format couldn’t be read' : `it’s ${ext ? `an ${ext}` : 'not a .mov'} file, not a QuickTime .mov`];
  }
  if (ext !== '.mov') problems.push(`it’s ${ext ? `an ${ext}` : 'not a .mov'} file, not a QuickTime .mov`);
  if (format.codec !== 'ap4h') problems.push(`it’s ${codecName(format.codec)}, not ProRes 4444`);
  if (format.width !== 1920 || format.height !== 1080) problems.push(`it’s ${format.width}×${format.height}, not 1920×1080`);
  if (format.fps === null || Math.abs(format.fps - 29.97) > 0.01) problems.push(`it’s ${format.fps ?? 'an unknown number of'} frames a second, not 29.97`);
  if (format.depth !== 32) problems.push('it has no alpha channel (no see-through parts)');
  return problems;
}

function codecName(code: string): string {
  const names: Record<string, string> = { ap4x: 'ProRes 4444 XQ', apch: 'ProRes 422 HQ', apcn: 'ProRes 422', apcs: 'ProRes 422 LT', apco: 'ProRes 422 Proxy', avc1: 'H.264', hvc1: 'H.265', hev1: 'H.265', mp4v: 'MPEG-4' };
  return names[code] ?? `“${code}”`;
}
