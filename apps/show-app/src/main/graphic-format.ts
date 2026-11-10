// The format check for L3, OTSL and OTSR graphics (RG, Nov 10, 2026): TSTV's graphics are 1920×1080,
// 29.97 frames a second, Apple ProRes 4444 with alpha, in a QuickTime .mov. Graphics sometimes come
// exported another way: as an .mp4 or ProRes 422, at another size or frame rate, as a still picture, or
// with a solid background instead of see-through parts. RiGster makes a copy in the right format, in its
// own folder, and plays that; the original on the drive isn't touched. A solid background is taken to be
// black, and its black parts become see-through (RG's choice), so black inside a graphic does too.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { ffmpegPath } from './ffmpeg.ts';

const run = promisify(execFile);

/** The element types whose graphics are checked. */
export const CHECKED_GRAPHIC_TYPES = new Set(['L3', 'OTSL', 'OTSR']);

/** How long a still picture's clip is. A graphic stays up after its clip ends, holding its last picture. */
export const STILL_SECONDS = 5;

export interface FormatProblem {
  /** What's wrong, for the producer: “it’s an .mp4, not a QuickTime .mov”. */
  text: string;
  /** It has no see-through parts: black is made see-through. */
  solid?: boolean;
}

/** What FFmpeg prints about a file (it exits with an error, as it's given nothing to do). */
async function describe(file: string): Promise<string> {
  if (!ffmpegPath) throw new Error('FFmpeg is missing.');
  return run(ffmpegPath, ['-hide_banner', '-i', file], { timeout: 15_000 }).then(
    (r) => r.stderr,
    (e: { stderr?: string }) => e.stderr ?? '',
  );
}

/** The lowest see-through value (0 clear to 255 solid) in the picture this far in, from a small copy of it. */
async function leastAlpha(file: string, at: number): Promise<number> {
  const { stdout } = await run(
    ffmpegPath!,
    ['-v', 'error', ...(at > 0 ? ['-ss', String(at)] : []), '-i', file, '-frames:v', '1', '-vf', 'format=rgba,alphaextract,scale=96:54:flags=area', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'],
    { encoding: 'buffer', timeout: 30_000, maxBuffer: 1 << 20 },
  );
  const bytes = stdout as unknown as Buffer;
  if (!bytes.length) return 255;
  let least = 255;
  for (const b of bytes) least = Math.min(least, b);
  return least;
}

/** What's wrong with an L3, OTSL or OTSR graphic's format; nothing when it's right. */
export async function checkGraphic(file: string): Promise<FormatProblem[]> {
  const output = await describe(file);
  const video = /Stream #[^\n]*Video: ([^\n]*)/.exec(output)?.[1];
  if (!video) throw new Error('FFmpeg can’t read its picture.');
  const problems: FormatProblem[] = [];
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(output);
  const seconds = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
  const still = seconds <= 0.2 || /^(png|mjpeg|bmp|tiff|gif|webp)\b/.test(video);
  const ext = path.extname(file).toLowerCase();
  if (still) problems.push({ text: 'it’s a still picture, not a clip' });
  else if (ext !== '.mov') problems.push({ text: `it’s ${ext ? `an ${ext}` : 'not a .mov'}, not a QuickTime .mov` });
  const codec = /^(\w+)/.exec(video)?.[1] ?? 'unknown';
  if (!still && !/^prores \(4444\)/.test(video)) problems.push({ text: `it’s ${codec === 'prores' ? `ProRes ${/^prores \(([^)]+)\)/.exec(video)?.[1] ?? ''}`.trim() : codec.toUpperCase()}, not ProRes 4444` });
  const size = /\b(\d{2,5})x(\d{2,5})\b/.exec(video);
  if (size && (size[1] !== '1920' || size[2] !== '1080')) problems.push({ text: `it’s ${size[1]}×${size[2]}, not 1920×1080` });
  const fps = Number(/([\d.]+) fps/.exec(video)?.[1]);
  if (!still && Number.isFinite(fps) && Math.abs(fps - 29.97) > 0.01) problems.push({ text: `it’s ${fps} frames a second, not 29.97` });
  // See-through parts: an alpha channel, and somewhere in the picture that's actually see-through (a file
  // can have one that's solid everywhere). Looked at a quarter, half and three quarters of the way in, as
  // a graphic may animate on.
  const alpha = /\b(yuva\w*|rgba\w*|argb|bgra|abgr|gbrap\w*|ya8|ya16\w*|pal8)\b/.test(video);
  let solid = !alpha;
  if (alpha) {
    const times = still ? [0] : [0.25, 0.5, 0.75].map((f) => Math.round(seconds * f * 100) / 100);
    solid = true;
    for (const t of times) if ((await leastAlpha(file, t)) < 250) solid = false;
  }
  if (solid) problems.push({ text: 'it has no see-through parts (its black is made see-through)', solid: true });
  return problems;
}

/**
 * Makes the graphic's copy in the right format, in folder, and returns where it is. A copy made before
 * from the same file (same place, size and time) is used again. It keeps the file's name, as a .mov.
 */
export async function convertGraphic(file: string, folder: string, problems: FormatProblem[]): Promise<string> {
  if (!ffmpegPath) throw new Error('FFmpeg is missing.');
  const info = await stat(file);
  const name = createHash('sha1').update(`${file}|${info.size}|${info.mtimeMs}`).digest('hex').slice(0, 20);
  const out = path.join(folder, name, `${path.basename(file, path.extname(file))}.mov`);
  if (await stat(out).catch(() => null)) return out;
  await mkdir(path.dirname(out), { recursive: true });
  const still = problems.some((p) => p.text.startsWith('it’s a still'));
  const key = problems.some((p) => p.solid);
  const picture = [
    'format=rgba',
    ...(key ? ['colorkey=0x000000:0.1:0.08'] : []),
    'scale=1920:1080:force_original_aspect_ratio=decrease',
    'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black@0',
    'fps=30000/1001',
    'format=yuva444p10le',
  ].join(',');
  const input = still ? ['-loop', '1', '-framerate', '30000/1001', '-t', String(STILL_SECONDS), '-i', file] : ['-i', file];
  const sound = still ? [] : ['-map', '0:a:0?', '-c:a', 'pcm_s16le', '-ar', '48000'];
  // Written under another name first, so a half-made copy is never played.
  const partial = `${out}.part`;
  try {
    await run(ffmpegPath, ['-v', 'error', '-y', ...input, '-map', '0:v:0', '-vf', picture, '-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0', ...sound, '-f', 'mov', partial], {
      timeout: 10 * 60_000,
    });
    await rename(partial, out);
    return out;
  } catch (e) {
    await rm(partial, { force: true });
    throw e;
  }
}
