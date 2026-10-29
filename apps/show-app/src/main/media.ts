// Reading graphics and clip files on this laptop: each clip's length, and a small thumbnail for the
// producer's preview. Uses FFmpeg, which comes with the app, so it reads ProRes 4444 as well. The files
// themselves never leave the laptop (only names and lengths go to the website).
import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';

const run = promisify(execFile);
// ffmpeg-static is the path to FFmpeg (its types describe the module rather than the path).
const ffmpegPath = ffmpegStatic as unknown as string | null;

export const MEDIA_EXTENSIONS = ['.mov', '.mp4', '.m4v', '.mxf', '.avi', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.wav', '.mp3'];

export interface FileInfo {
  path: string;
  /** The clip's length; null for a still picture. */
  seconds: number | null;
  /** A small JPEG, as a data: URL. */
  thumbnail: string | null;
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
 * A clip's length in seconds, or null for a still or a file FFmpeg can't read. FFmpeg prints a file's
 * "Duration: 00:01:30.04" when asked about it (and exits with an error, since it's given nothing to do).
 */
export async function clipSeconds(file: string): Promise<number | null> {
  if (!ffmpegPath) return null;
  const output = await run(ffmpegPath, ['-hide_banner', '-i', file], { timeout: 15_000 }).then(
    (r) => r.stderr,
    (e: { stderr?: string }) => e.stderr ?? '',
  );
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(output);
  if (!m) return null;
  const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  // A still picture reports a tiny duration.
  return seconds > 0.2 ? Math.round(seconds * 10) / 10 : null;
}

/** A 240-pixel-wide JPEG from a second into the clip (or the picture itself), as a data: URL. */
export async function thumbnail(file: string, seconds: number | null): Promise<string | null> {
  if (!ffmpegPath) return null;
  try {
    const at = seconds ? Math.min(1, seconds / 2) : 0;
    const { stdout } = await run(
      ffmpegPath,
      ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'scale=240:-2', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-'],
      { encoding: 'buffer', timeout: 20_000, maxBuffer: 2 * 1024 * 1024 },
    );
    return stdout.length > 0 ? `data:image/jpeg;base64,${Buffer.from(stdout).toString('base64')}` : null;
  } catch {
    return null;
  }
}

export async function readFile(file: string): Promise<FileInfo> {
  const seconds = await clipSeconds(file);
  return { path: file, seconds, thumbnail: await thumbnail(file, seconds) };
}
