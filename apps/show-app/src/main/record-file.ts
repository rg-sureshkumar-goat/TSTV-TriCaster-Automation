// Finishing a recording (RG, Nov 4, 2026). It's written in pieces, so it survives the laptop stopping partway,
// but QuickTime won't open every such file: not one whose sound track is empty, or whose last piece was cut
// short. So when a recording stops, its pieces are copied into a plain MP4, with nothing re-encoded. Should
// that fail, the file in pieces stays as it was.
import { execFile } from 'node:child_process';
import { rename, rm } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * FFmpeg's settings to record the program: the picture on stdin, timed by the clock, and the sound on pipe 3,
 * timed by its samples. Timed by the clock too, FFmpeg 9 squeezes all the sound into the first moment.
 */
export function recordingArgs(size: string, rate: string, file: string, platform: NodeJS.Platform = process.platform): string[] {
  const picture = platform === 'darwin' ? ['-c:v', 'h264_videotoolbox', '-b:v', '12M'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20'];
  return [
    '-v', 'error', '-y',
    '-use_wallclock_as_timestamps', '1', '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', size, '-r', rate, '-i', 'pipe:0',
    '-f', 'f32le', '-ar', '48000', '-ac', '2', '-i', 'pipe:3',
    '-map', '0:v', '-map', '1:a', ...picture, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
    '-fps_mode', 'cfr', '-r', rate, '-movflags', '+frag_keyframe+empty_moov', file,
  ];
}

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
