// Reading graphics and clip files on this laptop: each clip's length, and a small thumbnail for the
// producer's preview. Uses FFmpeg, which comes with the app, so it reads ProRes 4444 as well. The files
// themselves never leave the laptop (only names and lengths go to the website).
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { ffmpegPath } from './ffmpeg.ts';

const run = promisify(execFile);

export const MEDIA_EXTENSIONS = ['.mov', '.mp4', '.m4v', '.mxf', '.avi', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.wav', '.mp3', '.aif', '.aiff', '.m4a'];

/** Thumbnails made before this version are remade (2: graphics keep their see-through parts, Oct 29, 2026). */
export const THUMBNAIL_VERSION = 2;

export interface FileInfo {
  path: string;
  /** The clip's length; null for a still picture. */
  seconds: number | null;
  /**
   * A small picture, as a data: URL: a PNG that keeps a graphic's see-through parts, so the preview can
   * lay it over the camera, or a JPEG for video with none.
   */
  thumbnail: string | null;
  thumbnailVersion?: number;
  /** The copy the Program box plays, kept on this laptop (see makePlayable), once it's made. */
  playable?: string;
}

/** Every graphics or clip file in these paths, looking inside folders (one level down, like a USB drive's). */
export async function collectFiles(paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const p of paths) {
    const info = await stat(p).catch(() => null);
    if (!info) continue;
    if (info.isDirectory()) {
      for (const entry of await readdir(p, { withFileTypes: true })) {
        if (entry.isFile() && !entry.name.startsWith('.') && MEDIA_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) out.push(path.join(p, entry.name));
      }
    } else if (MEDIA_EXTENSIONS.includes(path.extname(p).toLowerCase())) {
      out.push(p);
    }
  }
  return out;
}

/**
 * What FFmpeg says about a file: its length in seconds (null for a still or a file it can't read), and
 * whether its picture has see-through parts (an alpha channel, as TSTV's ProRes 4444 graphics do). FFmpeg
 * prints both when asked about a file, like "Duration: 00:01:30.04" and "yuva444p12le" (and exits with an
 * error, since it's given nothing to do).
 */
export async function inspect(file: string): Promise<{ seconds: number | null; alpha: boolean; video: boolean }> {
  if (!ffmpegPath) return { seconds: null, alpha: false, video: false };
  const output = await run(ffmpegPath, ['-hide_banner', '-i', file], { timeout: 15_000 }).then(
    (r) => r.stderr,
    (e: { stderr?: string }) => e.stderr ?? '',
  );
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(output);
  const total = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
  const video = /Video:[^\n]*/.exec(output)?.[0] ?? '';
  // Pixel formats with an alpha channel: yuva…, rgba, argb, bgra, abgr, gbrap…, ya8/ya16, pal8 (PNG and GIF palettes).
  const alpha = /\b(yuva\w*|rgba\w*|argb|bgra|abgr|gbrap\w*|ya8|ya16\w*|pal8)\b/.test(video);
  // A still picture reports a tiny duration. An MP3's cover art is a "video" stream that isn't one.
  return { seconds: total > 0.2 ? Math.round(total * 10) / 10 : null, alpha, video: /Video:(?![^\n]*attached pic)/.test(output) };
}

export async function clipSeconds(file: string): Promise<number | null> {
  return (await inspect(file)).seconds;
}

/**
 * A 320-pixel-wide picture from the middle of the clip (at most 5 seconds in, when a graphic is fully on
 * screen), or the picture itself, as a data: URL. Graphics with see-through parts come out as PNG, which
 * keeps them; the rest as JPEG, which is smaller.
 */
export async function thumbnail(file: string, seconds: number | null, alpha = false): Promise<string | null> {
  if (!ffmpegPath) return null;
  try {
    const at = seconds ? Math.min(5, seconds / 2) : 0;
    // A still is read from its start: FFmpeg gives nothing back for a JPEG asked for "0 seconds in".
    const seek = at > 0 ? ['-ss', String(at)] : [];
    const format = alpha ? ['-vf', 'scale=320:-2,format=rgba', '-vcodec', 'png'] : ['-vf', 'scale=320:-2', '-vcodec', 'mjpeg', '-q:v', '5'];
    const { stdout } = await run(ffmpegPath, ['-v', 'error', ...seek, '-i', file, '-frames:v', '1', ...format, '-f', 'image2pipe', '-'], {
      encoding: 'buffer',
      timeout: 20_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout.length > 0 ? `data:image/${alpha ? 'png' : 'jpeg'};base64,${Buffer.from(stdout).toString('base64')}` : null;
  } catch {
    return null;
  }
}

/**
 * Whether the app can read a file right now: yes, missing (its drive isn't plugged in, or it was moved),
 * or blocked (macOS keeps apps out of USB drives unless allowed; picking the files in Import graphics
 * lets the app in until it closes).
 */
export async function readable(file: string): Promise<'yes' | 'missing' | 'blocked'> {
  try {
    await (await open(file, 'r')).close();
    return 'yes';
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'EPERM' || code === 'EACCES' ? 'blocked' : 'missing';
  }
}

/**
 * A copy of a graphic or clip that the app's window can play, for the Program box on the simulator (RG's
 * mock show, Oct 29, 2026). The window can't play ProRes, so a clip becomes a small WebM (VP9, keeping its
 * see-through parts, with its sound), a still becomes a PNG, and music becomes sound-only WebM (Opus). Each is made once, into folder on this
 * laptop, and found again by the file's path, size and date. Null if FFmpeg can't read the file.
 */
export async function makePlayable(file: string, folder: string): Promise<string | null> {
  const info = await stat(file).catch(() => null);
  if (!ffmpegPath || !info) return null;
  const { seconds, alpha, video } = await inspect(file);
  const name = createHash('sha1').update(`${file}|${info.size}|${info.mtimeMs}`).digest('hex').slice(0, 20);
  const out = path.join(folder, `${name}.${seconds ? 'webm' : 'png'}`);
  if (await stat(out).catch(() => null)) return out;
  await mkdir(folder, { recursive: true });
  // Written under another name first, so a half-made copy is never played.
  const partial = `${out}.part`;
  const args = !video
    ? ['-vn', '-c:a', 'libopus', '-b:a', '128k', '-ac', '2', '-f', 'webm']
    : seconds
    ? ['-vf', `scale=640:-2${alpha ? ',format=yuva420p' : ''}`, '-c:v', 'libvpx-vp9', '-b:v', '800k', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', ...(alpha ? ['-auto-alt-ref', '0'] : []), '-c:a', 'libopus', '-b:a', '96k', '-ac', '2', '-f', 'webm']
    : ['-frames:v', '1', '-vf', 'scale=640:-2,format=rgba', '-c:v', 'png', '-f', 'image2'];
  try {
    await run(ffmpegPath, ['-v', 'error', '-y', '-i', file, ...args, partial], { timeout: 10 * 60_000 });
    await rename(partial, out);
    return out;
  } catch {
    await rm(partial, { force: true });
    return null;
  }
}

export async function readFile(file: string): Promise<FileInfo> {
  const { seconds, alpha } = await inspect(file);
  return { path: file, seconds, thumbnail: await thumbnail(file, seconds, alpha), thumbnailVersion: THUMBNAIL_VERSION };
}
