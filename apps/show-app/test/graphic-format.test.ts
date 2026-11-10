// L3, OTSL and OTSR graphics in the wrong format (RG, Nov 10, 2026): RiGster checks each one it imports,
// and plays a copy in the right one (1080p, 29.97, ProRes 4444 with alpha, QuickTime), leaving the original.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import * as Y from 'yjs';
import ffmpegStatic from 'ffmpeg-static';
import { addElement, DEFAULT_SHOW_SETTINGS, insertBlock, insertSection, type ShowSettings } from '@tstv/shared';
import { checkGraphic, convertGraphic } from '../src/main/graphic-format.ts';
import { Runtime } from '../src/main/runtime.ts';
import { Store } from '../src/main/store.ts';

const run = promisify(execFile);
const ffmpeg = ffmpegStatic as unknown as string;
let folder: string;
const usb = (name: string) => path.join(folder, 'usb', name);

/** A white bar, as a lower third, over black (no see-through parts) or over see-through. */
const bar = 'drawbox=x=100:y=500:w=600:h=120:color=white:t=fill';
const make = (args: string[]) => run(ffmpeg, ['-v', 'error', '-y', ...args]);

/** How see-through one spot of a clip is, a second in: 0 clear to 255 solid. */
async function alphaAt(file: string, x: number, y: number): Promise<number> {
  const { stdout } = await run(ffmpeg, ['-v', 'error', '-ss', '1', '-i', file, '-frames:v', '1', '-vf', `format=rgba,alphaextract,crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], { encoding: 'buffer' });
  return (stdout as unknown as Buffer)[0];
}

beforeAll(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), 'tstv-format-'));
  await mkdir(path.join(folder, 'usb'));
  await Promise.all([
    // An H.264 .mp4, 720p at 59.94, on black.
    make(['-f', 'lavfi', '-i', `color=c=black:s=1280x720:d=2:r=60000/1001,${bar}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', usb('A1_L3_Score.mp4')]),
    // A still picture with see-through parts.
    make(['-f', 'lavfi', '-i', `color=c=black@0:s=1920x1080,format=rgba,${bar}`, '-frames:v', '1', usb('A2_OTSL_Map.png')]),
    // ProRes 4444 with an alpha channel that's solid everywhere.
    make(['-f', 'lavfi', '-i', `color=c=black:s=1920x1080:d=2:r=30000/1001,format=rgba,${bar}`, '-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', usb('A3_OTSR_Solid.mov')]),
    // Just right.
    make(['-f', 'lavfi', '-i', `color=c=black@0:s=1920x1080:d=2:r=30000/1001,format=rgba,${bar}`, '-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', usb('A4_L3_Good.mov')]),
  ]);
}, 60_000);

afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe('the format check for L3, OTSL and OTSR graphics', () => {
  it('says what’s wrong, in words the producer knows', async () => {
    expect((await checkGraphic(usb('A1_L3_Score.mp4'))).map((p) => p.text)).toEqual([
      'it’s an .mp4, not a QuickTime .mov',
      'it’s H264, not ProRes 4444',
      'it’s 1280×720, not 1920×1080',
      'it’s 59.94 frames a second, not 29.97',
      'it has no see-through parts (its black is made see-through)',
    ]);
    expect((await checkGraphic(usb('A2_OTSL_Map.png'))).map((p) => p.text)).toEqual(['it’s a still picture, not a clip']);
    // An alpha channel that's solid everywhere counts as no see-through parts.
    expect((await checkGraphic(usb('A3_OTSR_Solid.mov'))).map((p) => p.text)).toEqual(['it has no see-through parts (its black is made see-through)']);
    expect(await checkGraphic(usb('A4_L3_Good.mov'))).toEqual([]);
  }, 60_000);

  it('makes a copy in the right format, with the black made see-through', async () => {
    const problems = await checkGraphic(usb('A1_L3_Score.mp4'));
    const copy = await convertGraphic(usb('A1_L3_Score.mp4'), path.join(folder, 'converted'), problems);
    expect(path.basename(copy)).toBe('A1_L3_Score.mov');
    expect(await checkGraphic(copy)).toEqual([]);
    // The bar (made 1.5 times bigger, to 1080p) stays solid; the black around it is see-through.
    expect(await alphaAt(copy, 200, 780)).toBe(255);
    expect(await alphaAt(copy, 200, 200)).toBe(0);
    // A still becomes a 5-second clip.
    const still = await convertGraphic(usb('A2_OTSL_Map.png'), path.join(folder, 'converted'), await checkGraphic(usb('A2_OTSL_Map.png')));
    const { stderr } = await run(ffmpeg, ['-hide_banner', '-i', still]).catch((e: { stderr: string }) => e);
    expect(stderr).toMatch(/Duration: 00:00:05\.0/);
    expect(await checkGraphic(still)).toEqual([]);
  }, 120_000);
});

describe('importing graphics into RiGster', () => {
  let runtime: Runtime;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const alex = { id: 'u1', name: 'Alex Producer' };
    const doc = new Y.Doc();
    insertBlock(doc, alex);
    for (const [n, slug, type] of [['1', 'Score', 'L3'], ['2', 'Map', 'OTSL'], ['3', 'Solid', 'OTSR'], ['4', 'Good', 'L3']] as const) {
      ids[`a${n}`] = insertSection(doc, alex, { slug, type: 'Reader' });
      ids[type + n] = addElement(doc, ids[`a${n}`], type, alex, slug)!;
    }
    runtime = new Runtime({ store: new Store(path.join(folder, 'app')), pickFiles: async () => [], pickFile: async () => null });
    const settings: ShowSettings = { ...DEFAULT_SHOW_SETTINGS };
    Object.assign(runtime.website, { doc, status: 'connected', show: { id: 'show1', name: 'PrimeTime', settings }, episode: { id: 'ep1', title: 'Formats', airDate: '', airTime: '' } });
    runtime.website.emit('rundown');
  });

  afterAll(() => runtime?.close());

  it('converts the ones in the wrong format, and plays its copies', async () => {
    await runtime.act({ kind: 'addFiles', paths: [path.join(folder, 'usb')] });
    const elements = () => runtime.state().sections.flatMap((s) => s.elements);
    const end = Date.now() + 90_000;
    while (elements().filter((e) => e.fixes).length < 3 || elements().some((e) => e.converting)) {
      if (Date.now() > end) throw new Error('timed out waiting for the conversions');
      await new Promise((r) => setTimeout(r, 100));
    }
    const byId = Object.fromEntries(elements().map((e) => [e.id, e]));
    expect(byId[ids.L31].file).toBe('A1_L3_Score.mov');
    expect(byId[ids.L31].fixes).toContain('it’s H264, not ProRes 4444');
    expect(byId[ids.OTSL2].file).toBe('A2_OTSL_Map.mov');
    expect(byId[ids.OTSL2].seconds).toBeCloseTo(5, 0);
    expect(byId[ids.OTSR3].fixes).toEqual(['it has no see-through parts (its black is made see-through)']);
    // The right one is left as it is.
    expect(byId[ids.L34].file).toBe('A4_L3_Good.mov');
    expect(byId[ids.L34].fixes).toBeNull();
    // The originals are still on the drive.
    expect(await stat(usb('A1_L3_Score.mp4'))).toBeTruthy();
    expect(runtime.state().log.some((l) => l.text.startsWith('A1_L3_Score.mp4 converted to 1080p ProRes 4444'))).toBe(true);
    // Importing the drive again keeps the copies on their cues, without converting again.
    await runtime.act({ kind: 'addFiles', paths: [path.join(folder, 'usb')] });
    await new Promise((r) => setTimeout(r, 1500));
    expect(elements().find((e) => e.id === ids.L31)?.file).toBe('A1_L3_Score.mov');
    expect(elements().find((e) => e.id === ids.L31)?.fixes).not.toBeNull();
  }, 120_000);
});
