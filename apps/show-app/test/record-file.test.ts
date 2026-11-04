// Finishing a recording (RG, Nov 4, 2026): QuickTime refused a recording with an empty sound track, and a last
// piece cut short. Finishing leaves a plain MP4 with what was recorded, whatever state it was in.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, truncate } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';
import { finishRecording, recordingArgs, silenceDue } from '../src/main/record-file.ts';

const run = promisify(execFile);
const ffmpeg = ffmpegStatic as unknown as string;
let folder: string;

/** What's in a file: a plain MP4 has its index up front and no pieces, and these are its streams. */
async function look(file: string) {
  const data = await readFile(file);
  const said = await run(ffmpeg, ['-hide_banner', '-i', file]).catch((e: { stderr: string }) => e.stderr);
  return { pieces: data.includes(Buffer.from('moof')), indexFirst: data.indexOf(Buffer.from('moov')) < data.indexOf(Buffer.from('mdat')), video: /Video: h264/.test(String(said)), audio: /Audio: aac/.test(String(said)) };
}

async function record(name: string, sound: boolean): Promise<string> {
  const file = path.join(folder, name);
  await run(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=3', ...(sound ? ['-f', 'lavfi', '-i', 'sine=d=3', '-c:a', 'aac'] : []), '-c:v', 'libx264', '-g', '15', '-pix_fmt', 'yuv420p', '-movflags', '+frag_keyframe+empty_moov', file]);
  return file;
}

beforeAll(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), 'tstv-record-file-'));
});
afterAll(async () => {
  await rm(folder, { recursive: true, force: true, maxRetries: 5 });
});

describe('finishing a recording', () => {
  it('makes a plain MP4 with its picture and sound', async () => {
    const file = await record('whole.mp4', true);
    expect((await look(file)).pieces).toBe(true);
    await finishRecording(ffmpeg, file);
    expect(await look(file)).toEqual({ pieces: false, indexFirst: true, video: true, audio: true });
  });

  it('keeps everything up to a last piece that was cut short', async () => {
    const file = await record('cut.mp4', true);
    await truncate(file, (await stat(file)).size - 2000);
    await finishRecording(ffmpeg, file);
    expect(await look(file)).toMatchObject({ pieces: false, video: true });
  });

  it('leaves the file in pieces as it was if it can’t be finished', async () => {
    const file = await record('stays.mp4', true);
    const before = (await stat(file)).size;
    await expect(finishRecording(path.join(folder, 'no-ffmpeg'), file)).rejects.toThrow();
    expect((await stat(file)).size).toBe(before);
  });

  it('records sound that lasts as long as the picture', async () => {
    const file = path.join(folder, 'recorded.mp4');
    const encoder = spawn(ffmpeg, recordingArgs('320x180', '30', file), { stdio: ['pipe', 'ignore', 'ignore', 'pipe'] });
    const sound = encoder.stdio[3] as NodeJS.WritableStream;
    const frame = Buffer.alloc(320 * 180 * 4, 0x80);
    const chunk = Buffer.alloc(1600 * 2 * 4);
    for (let i = 0; i < 90; i++) {
      encoder.stdin!.write(frame);
      sound.write(chunk);
      await new Promise((r) => setTimeout(r, 33));
    }
    const stopped = new Promise((resolve) => encoder.once('exit', resolve));
    encoder.stdin!.end();
    sound.end();
    await stopped;
    await finishRecording(ffmpeg, file);
    expect(await look(file)).toEqual({ pieces: false, indexFirst: true, video: true, audio: true });
    const list = (await run(ffmpeg, ['-v', 'error', '-i', file, '-map', '0:a', '-c', 'copy', '-f', 'framecrc', '-'])).stdout;
    const lines = list.split('\n').filter((l) => l && !l.startsWith('#'));
    const lastAt = Number(lines.at(-1)!.split(',')[2]) / 48_000;
    expect(lastAt).toBeGreaterThan(2.5);
    expect(lastAt).toBeLessThan(3.5);
  }, 30_000);

  it('fills silence only when the sound has fallen behind', () => {
    expect(silenceDue(100, 0)).toBe(0);
    expect(silenceDue(1000, 0)).toBe(48_000);
    expect(silenceDue(1000, 47_000)).toBe(0);
    expect(silenceDue(2000, 48_000)).toBe(48_000);
  });
});
