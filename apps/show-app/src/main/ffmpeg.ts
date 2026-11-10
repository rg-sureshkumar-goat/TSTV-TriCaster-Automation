// Where FFmpeg is. Run from the source, it's the one ffmpeg-static downloaded; in the installed app
// (Phase 6) it's the copy packed with the app, in its bin folder.
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Set to true when the app is bundled for installing (scripts/package.mjs). */
declare const BUNDLED: boolean | undefined;

function find(): string | null {
  if (typeof BUNDLED !== 'undefined' && BUNDLED) {
    // The bundle is in dist/main, two folders down from the app's own folder.
    return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  }
  // ffmpeg-static is the path to FFmpeg (its types describe the module rather than the path).
  return createRequire(import.meta.url)('ffmpeg-static') as string | null;
}

export const ffmpegPath = find();

/** FFmpeg runs making copies in the background, so closing RiGster can stop them. */
const background = new Set<{ pid?: number; kill(signal?: NodeJS.Signals): boolean; once(event: 'exit', listener: () => void): unknown }>();

/**
 * FFmpeg making a copy in the background (a graphic converted, or the Program box's copy) runs at low
 * priority, so it never takes the CPU from the playout and the cues during a show (Nov 10, 2026).
 */
export function inBackground(child: { pid?: number; kill(signal?: NodeJS.Signals): boolean; once(event: 'exit', listener: () => void): unknown }): void {
  background.add(child);
  child.once('exit', () => background.delete(child));
  try {
    if (child.pid) os.setPriority(child.pid, os.constants.priority.PRIORITY_LOW);
  } catch {
    // Not allowed here: it runs at the usual priority.
  }
}

/**
 * Stops the copies being made, as RiGster closes, so no file on a drive is left open (on Windows a drive
 * can't be ejected, or a file deleted, while FFmpeg is still reading it). The copies are made again later.
 */
export function stopBackground(): void {
  for (const child of background) child.kill('SIGKILL');
  background.clear();
}
