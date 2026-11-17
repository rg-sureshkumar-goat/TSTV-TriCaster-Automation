// Reading a graphic's format before it's uploaded (RG, Nov 17, 2026), from real files made by FFmpeg.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, open, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';
import { graphicFormatProblems, readVideoFormat } from '../src/quicktime.ts';

const run = promisify(execFile);
let folder: string;
const make = (name: string, args: string[]) => run(ffmpegStatic as unknown as string, ['-v', 'error', '-y', ...args, path.join(folder, name)]);

async function formatOf(name: string) {
  const file = path.join(folder, name);
  const handle = await open(file);
  try {
    const read = async (start: number, end: number) => {
      const buffer = Buffer.alloc(end - start);
      await handle.read(buffer, 0, end - start, start);
      return new Uint8Array(buffer);
    };
    return await readVideoFormat(read, (await stat(file)).size);
  } finally {
    await handle.close();
  }
}

beforeAll(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), 'tstv-quicktime-'));
  const bar = 'color=c=black@0:s=1920x1080:d=1:r=30000/1001,format=rgba';
  await Promise.all([
    make('right.mov', ['-f', 'lavfi', '-i', bar, '-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le']),
    make('no-alpha.mov', ['-f', 'lavfi', '-i', 'color=c=black:s=1920x1080:d=1:r=30000/1001', '-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuv444p10le']),
    make('h264.mp4', ['-f', 'lavfi', '-i', 'color=c=black:s=1280x720:d=1:r=60000/1001', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']),
    make('h264-moov-first.m4v', ['-f', 'lavfi', '-i', 'color=c=black:s=1920x1080:d=1:r=30000/1001', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']),
    // As B3_L3_ADHIA.mov is (RG, Nov 17, 2026): right in every way, at 23.98 frames a second.
    make('right-23.98.mov', ['-f', 'lavfi', '-i', 'color=c=black@0:s=1920x1080:d=1:r=24000/1001,format=rgba', '-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p12le']),
    make('422.mov', ['-f', 'lavfi', '-i', 'color=c=black:s=1920x1080:d=1:r=25', '-c:v', 'prores_ks', '-profile:v', '2']),
  ]);
}, 60_000);

afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe('reading a graphic’s format before it’s uploaded', () => {
  it('finds ProRes 4444 with alpha at 1080p 29.97 in a .mov, which needs nothing done', async () => {
    const format = await formatOf('right.mov');
    expect(format).toEqual({ codec: 'ap4h', width: 1920, height: 1080, fps: 29.97, depth: 32 });
    expect(graphicFormatProblems('A1_L3_Score.mov', format)).toEqual([]);
  });

  it('takes 23.98 frames a second as right too (RG, Nov 17, 2026)', async () => {
    const format = await formatOf('right-23.98.mov');
    expect(format).toEqual({ codec: 'ap4h', width: 1920, height: 1080, fps: 23.98, depth: 32 });
    expect(graphicFormatProblems('B3_L3_ADHIA.mov', format)).toEqual([]);
  });

  it('says what’s wrong with the rest, in plain words', async () => {
    expect(graphicFormatProblems('a.mov', await formatOf('no-alpha.mov'))).toEqual(['it has no alpha channel (no see-through parts)']);
    expect(graphicFormatProblems('A1_L3.mp4', await formatOf('h264.mp4'))).toEqual([
      'it’s an .mp4 file, not a QuickTime .mov',
      'it’s H.264, not ProRes 4444',
      'it’s 1280×720, not 1920×1080',
      'it’s 59.94 frames a second, not 29.97 or 23.98',
      'it has no alpha channel (no see-through parts)',
    ]);
    // The index at the start of the file (as web exports have it) is read too.
    expect((await formatOf('h264-moov-first.m4v'))?.codec).toBe('avc1');
    expect(graphicFormatProblems('a.mov', await formatOf('422.mov'))).toEqual(['it’s ProRes 422, not ProRes 4444', 'it’s 25 frames a second, not 29.97 or 23.98', 'it has no alpha channel (no see-through parts)']);
    expect(graphicFormatProblems('Logo.png', null)).toEqual(['it’s a still picture, not a clip']);
  });
});
