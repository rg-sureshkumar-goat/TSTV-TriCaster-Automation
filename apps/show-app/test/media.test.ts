// Thumbnails for the preview: graphics keep their see-through parts, so the preview can lay them over the
// camera; video without any stays a smaller JPEG.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';
import { readFile, THUMBNAIL_VERSION } from '../src/main/media.ts';

const run = promisify(execFile);
const ffmpeg = ffmpegStatic as unknown as string;
let folder: string;

beforeAll(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), 'tstv-media-'));
  // A lower third like the graphics team's: ProRes 4444 with an alpha channel, see-through except a bar.
  await run(ffmpeg, [
    '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black@0.0:s=320x180:d=2,format=yuva444p10le,drawbox=x=0:y=130:w=320:h=40:color=red@1:t=fill:replace=1',
    '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-y', path.join(folder, 'A1_L3_Score.mov'),
  ]);
  await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=2', '-pix_fmt', 'yuv420p', '-y', path.join(folder, 'A2_VO_Highlights.mp4')]);
  // A green-screen background picture, as a JPEG.
  await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=s=640x360', '-frames:v', '1', '-y', path.join(folder, 'Studio background.jpg')]);
}, 30_000);

afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe('preview thumbnails', () => {
  it('keeps a ProRes 4444 graphic’s see-through parts, as a PNG with an alpha channel', async () => {
    const info = await readFile(path.join(folder, 'A1_L3_Score.mov'));
    expect(info.seconds).toBe(2);
    expect(info.thumbnailVersion).toBe(THUMBNAIL_VERSION);
    expect(info.thumbnail).toMatch(/^data:image\/png;base64,/);
    const png = Buffer.from(info.thumbnail!.split(',')[1], 'base64');
    // Byte 25 of a PNG is its color type: 6 means red, green, blue and alpha.
    expect(png[25]).toBe(6);
    // The top is see-through and the bar is solid, so the bar shows over the camera and the rest doesn't.
    const thumb = path.join(folder, 'thumb.png');
    await writeFile(thumb, png);
    const { stdout } = await run(ffmpeg, ['-v', 'error', '-i', thumb, '-vf', 'format=rgba', '-f', 'rawvideo', '-'], { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 });
    const alphaAt = (x: number, y: number) => stdout[(y * 320 + x) * 4 + 3];
    expect(alphaAt(10, 10)).toBe(0);
    expect(alphaAt(10, 150)).toBe(255);
  }, 20_000);

  it('makes video without see-through parts a JPEG', async () => {
    const info = await readFile(path.join(folder, 'A2_VO_Highlights.mp4'));
    expect(info.thumbnail).toMatch(/^data:image\/jpeg;base64,/);
  }, 20_000);

  it('makes a thumbnail of a still picture, like a JPEG background', async () => {
    const info = await readFile(path.join(folder, 'Studio background.jpg'));
    expect(info.seconds).toBeNull();
    expect(info.thumbnail).toMatch(/^data:image\/jpeg;base64,/);
  }, 20_000);
});
