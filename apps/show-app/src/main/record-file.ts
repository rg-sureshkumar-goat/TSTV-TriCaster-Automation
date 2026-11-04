// Finishing a recording (RG, Nov 4, 2026). It's written in pieces, so it survives the laptop stopping partway,
// but QuickTime won't open every such file: not one whose sound track is empty, or whose last piece was cut
// short. So when a recording stops, its pieces are copied into a plain MP4, with nothing re-encoded. Should
// that fail, the file in pieces stays as it was.
import { execFile } from 'node:child_process';
import { rename, rm } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);

export async function finishRecording(ffmpeg: string, file: string): Promise<void> {
  const part = `${file}.finishing.mp4`;
  try {
    await run(ffmpeg, ['-v', 'error', '-y', '-i', file, '-map', '0', '-c', 'copy', '-movflags', '+faststart', part], { timeout: 10 * 60_000 });
    await rename(part, file);
  } finally {
    await rm(part, { force: true });
  }
}

/** Keeps a recording's sound going: how many stereo samples of silence are due, when the TC1 sends none for a moment. */
export function silenceDue(elapsedMs: number, samplesSent: number, rate = 48_000, slackMs = 250): number {
  const due = Math.floor((elapsedMs / 1000) * rate);
  return due - samplesSent > (slackMs / 1000) * rate ? due - samplesSent : 0;
}
