// Where FFmpeg is. Run from the source, it's the one ffmpeg-static downloaded; in the installed app
// (Phase 6) it's the copy packed with the app, in its bin folder.
import { createRequire } from 'node:module';
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
