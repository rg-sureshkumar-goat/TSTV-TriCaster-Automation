// The format check for L3, OTSL and OTSR graphics (RG, Nov 10, 2026): TSTV's graphics are 1920×1080,
// 29.97 frames a second, Apple ProRes 4444 with alpha, in a QuickTime .mov. Graphics sometimes come
// exported another way: as an .mp4 or ProRes 422, at another size or frame rate, as a still picture, or
// with a solid background instead of see-through parts. RiGster makes a copy in the right format, in its
// own folder, and plays that; the original on the drive isn't touched. A solid background is taken to be
// black: the black around the graphic, joined to the picture's edges, becomes see-through, and black inside
// the graphic (text, a box with color around it) stays, as TSTV's graphics use black (RG, Nov 10, 2026).
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { ffmpegPath, inBackground } from './ffmpeg.ts';
import { startWorker } from './workers.ts';

const run = promisify(execFile);

/** The element types whose graphics are checked. */
export const CHECKED_GRAPHIC_TYPES = new Set(['L3', 'OTSL', 'OTSR']);

/** How long a still picture's clip is. A graphic stays up after its clip ends, holding its last picture. */
export const STILL_SECONDS = 5;

const WIDTH = 1920;
const HEIGHT = 1080;
/** As dark as this (0 to 255) counts as background black; up to EDGE, a background's soft edge. */
const BLACK = 24;
const EDGE = 80;

/**
 * Makes the black around a graphic see-through, in one RGBA picture: every near-black or see-through pixel
 * joined to the picture's edges, found by spreading in from them. The ring of pixels just inside, the
 * graphic's soft edge against the black, becomes partly see-through, so no dark outline is left. Black
 * with the graphic all around it isn't reached, and stays.
 */
export function clearOutsideBlack(rgba: Buffer, width = WIDTH, height = HEIGHT): void {
  const count = width * height;
  const luma = (i: number) => (rgba[i * 4] * 54 + rgba[i * 4 + 1] * 183 + rgba[i * 4 + 2] * 19) >> 8;
  const background = (i: number) => rgba[i * 4 + 3] < 16 || luma(i) <= BLACK;
  const seen = new Uint8Array(count);
  const queue = new Int32Array(count);
  let head = 0;
  let tail = 0;
  const visit = (i: number) => {
    if (seen[i] || !background(i)) return;
    seen[i] = 1;
    queue[tail++] = i;
  };
  for (let x = 0; x < width; x++) {
    visit(x);
    visit((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    visit(y * width);
    visit(y * width + width - 1);
  }
  while (head < tail) {
    const i = queue[head++];
    rgba[i * 4 + 3] = 0;
    const x = i % width;
    if (x > 0) visit(i - 1);
    if (x < width - 1) visit(i + 1);
    if (i >= width) visit(i - width);
    if (i < count - width) visit(i + width);
  }
  // The soft edge: a dark pixel next to the cleared black is partly see-through, its color brightened back.
  for (let i = 0; i < count; i++) {
    if (seen[i]) continue;
    const x = i % width;
    const touches = (x > 0 && seen[i - 1]) || (x < width - 1 && seen[i + 1]) || (i >= width && seen[i - width]) || (i < count - width && seen[i + width]);
    const l = luma(i);
    if (!touches || l >= EDGE) continue;
    const a = (l - BLACK) / (EDGE - BLACK);
    rgba[i * 4 + 3] = Math.round(rgba[i * 4 + 3] * a);
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = Math.min(255, Math.round(rgba[i * 4 + c] / a));
  }
}

/** Copies made before this version are made again (2: only the black around the graphic is cleared). */
const COPY_VERSION = 2;

/** The workers converting graphics right now. */
const workers = new Set<ReturnType<typeof startWorker>>();

/** Stops the conversions under way, as RiGster closes: each worker stops its FFmpeg, then itself. */
export function stopConversions(): void {
  for (const worker of workers) worker.postMessage('stop');
}

/** Converts a graphic in a background worker (see convert-worker.ts), and says where its copy is. */
export function convertInBackground(file: string, folder: string, problems: FormatProblem[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = startWorker('convert-worker', { file, folder, problems });
    workers.add(worker);
    worker.once('exit', () => workers.delete(worker));
    worker.once('message', (m: { path?: string; error?: string }) => (m.path ? resolve(m.path) : reject(new Error(m.error))));
    worker.once('error', reject);
    worker.once('exit', (code) => reject(new Error(`The conversion stopped (${code}).`)));
  });
}

export interface FormatProblem {
  /** What's wrong, for the producer: “it’s an .mp4, not a QuickTime .mov”. */
  text: string;
  /** It has no see-through parts: the black around the graphic is made see-through. */
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
  if (solid) problems.push({ text: 'it has no see-through parts (the black around the graphic is made see-through)', solid: true });
  return problems;
}

/** Where a graphic's copy in the right format is, if it was made before (same file, size and time); else null. */
export async function existingCopy(file: string, folder: string): Promise<string | null> {
  const out = await copyPath(file, folder);
  return (await stat(out).catch(() => null)) ? out : null;
}

async function copyPath(file: string, folder: string): Promise<string> {
  const info = await stat(file);
  const name = createHash('sha1').update(`${file}|${info.size}|${info.mtimeMs}|${COPY_VERSION}`).digest('hex').slice(0, 20);
  return path.join(folder, name, `${path.basename(file, path.extname(file))}.mov`);
}

/**
 * Makes the graphic's copy in the right format, in folder, and returns where it is. A copy made before
 * from the same file (same place, size and time) is used again. It keeps the file's name, as a .mov.
 */
export async function convertGraphic(file: string, folder: string, problems: FormatProblem[]): Promise<string> {
  if (!ffmpegPath) throw new Error('FFmpeg is missing.');
  const out = await copyPath(file, folder);
  if (await stat(out).catch(() => null)) return out;
  await mkdir(path.dirname(out), { recursive: true });
  const still = problems.some((p) => p.text.startsWith('it’s a still'));
  const key = problems.some((p) => p.solid);
  // Without a solid background, one FFmpeg does it all. With one, RiGster clears the black around the
  // graphic itself, frame by frame, between an FFmpeg reading the file and one writing the copy.
  const picture = [
    'format=rgba',
    'scale=1920:1080:force_original_aspect_ratio=decrease',
    'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black@0',
    'fps=30000/1001',
    'format=yuva444p10le',
  ].join(',');
  const input = still ? ['-loop', '1', '-framerate', '30000/1001', '-t', String(STILL_SECONDS), '-i', file] : ['-i', file];
  const sound = still ? [] : ['-map', '0:a:0?', '-c:a', 'pcm_s16le', '-ar', '48000'];
  // Written under another name first, so a half-made copy is never played.
  const partial = `${out}.part`;
  const prores = ['-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0'];
  try {
    if (key) {
      const reading = ['-v', 'error', ...input, '-map', '0:v:0', '-vf', picture.replace(/,format=yuva444p10le$/, ',format=rgba'), '-f', 'rawvideo', 'pipe:1'];
      const fromFile = still ? [] : ['-i', file, '-map', '0:v', '-map', '1:a:0?', '-c:a', 'pcm_s16le', '-ar', '48000'];
      const writing = ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${WIDTH}x${HEIGHT}`, '-framerate', '30000/1001', '-i', 'pipe:0', ...fromFile, ...(still ? ['-map', '0:v'] : []), ...prores, '-f', 'mov', partial];
      await clearAndWrite(reading, writing);
    } else {
      const making = run(ffmpegPath, ['-v', 'error', '-y', ...input, '-map', '0:v:0', '-vf', picture, ...prores, ...sound, '-f', 'mov', partial], { timeout: 10 * 60_000 });
      inBackground(making.child);
      await making;
    }
    await rename(partial, out);
    return out;
  } catch (e) {
    await rm(partial, { force: true });
    throw e;
  }
}

/** Pipes each picture from one FFmpeg to the other, with the black around the graphic cleared. */
async function clearAndWrite(reading: string[], writing: string[]): Promise<void> {
  const reader = spawn(ffmpegPath!, reading, { stdio: ['ignore', 'pipe', 'ignore'] });
  const writer = spawn(ffmpegPath!, writing, { stdio: ['pipe', 'ignore', 'ignore'] });
  inBackground(reader);
  inBackground(writer);
  const finished = (p: ChildProcess) =>
    new Promise<void>((resolve, reject) => {
      p.on('error', reject);
      p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`FFmpeg stopped (${code})`))));
    });
  const read = finished(reader);
  const written = finished(writer);
  // Ten minutes at most, as for any other copy.
  const timer = setTimeout(() => (reader.kill('SIGKILL'), writer.kill('SIGKILL')), 10 * 60_000);
  try {
    const size = WIDTH * HEIGHT * 4;
    let pending: Buffer = Buffer.alloc(0);
    for await (const chunk of reader.stdout!) {
      pending = pending.length ? Buffer.concat([pending, chunk as Buffer]) : (chunk as Buffer);
      while (pending.length >= size) {
        const frame = Buffer.from(pending.subarray(0, size));
        pending = pending.subarray(size);
        clearOutsideBlack(frame);
        if (!writer.stdin!.write(frame)) await once(writer.stdin!, 'drain');
      }
    }
    writer.stdin!.end();
    await Promise.all([read, written]);
  } catch (e) {
    reader.kill('SIGKILL');
    writer.kill('SIGKILL');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
