// RiGster's file converter was taken out (RG, Nov 17, 2026). A graphic it had converted plays its original
// file again; and the playout is given a cue's new file even when its name stays the same.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import * as Y from 'yjs';
import ffmpegStatic from 'ffmpeg-static';
import { addElement, DEFAULT_SHOW_SETTINGS, insertBlock, insertSection, type ShowSettings } from '@tstv/shared';
import { playlistUpToDate, Runtime } from '../src/main/runtime.ts';
import { readFile } from '../src/main/media.ts';
import { Store } from '../src/main/store.ts';

const run = promisify(execFile);
let folder: string;
const usb = (name: string) => path.join(folder, 'usb', name);
const make = (file: string) => run(ffmpegStatic as unknown as string, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:d=1', '-pix_fmt', 'yuv420p', file]);

beforeAll(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), 'tstv-originals-'));
  await mkdir(path.join(folder, 'usb'));
  await mkdir(path.join(folder, 'converted'));
  await make(usb('A1_L3_Score.m4v'));
  await make(path.join(folder, 'converted', 'A1_L3_Score.mov'));
});

afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe('graphics RiGster converted before the converter was taken out', () => {
  it('go back to their original files', async () => {
    const alex = { id: 'u1', name: 'Alex Producer' };
    const doc = new Y.Doc();
    insertBlock(doc, alex);
    const section = insertSection(doc, alex, { slug: 'Score', type: 'Reader' });
    const l3 = addElement(doc, section, 'L3', alex, 'Score')!;
    const runtime = new Runtime({ store: new Store(path.join(folder, 'app')), pickFiles: async () => [], pickFile: async () => null });
    const settings: ShowSettings = { ...DEFAULT_SHOW_SETTINGS };
    Object.assign(runtime.website, { doc, status: 'connected', show: { id: 'show1', name: 'PrimeTime', settings }, episode: { id: 'ep1', title: 'Originals', airDate: '', airTime: '' } });
    // As saved by RiGster 1.0.2 or 1.0.3: the cue plays the converted copy, with the imported file as original.
    const copy = await readFile(path.join(folder, 'converted', 'A1_L3_Score.mov'));
    (runtime as unknown as { files: Record<string, unknown> }).files[l3] = { ...copy, original: usb('A1_L3_Score.m4v'), fixes: ['it’s an .m4v, not a QuickTime .mov'] };
    runtime.website.emit('rundown');
    const file = () => runtime.state().sections.flatMap((s) => s.elements).find((e) => e.id === l3)?.file;
    expect(file()).toBe('A1_L3_Score.mov');
    await (runtime as unknown as { makePlayables: () => Promise<void> }).makePlayables();
    const end = Date.now() + 10_000;
    while (file() !== 'A1_L3_Score.m4v') {
      if (Date.now() > end) throw new Error('timed out waiting');
      await new Promise((r) => setTimeout(r, 50));
    }
    await runtime.close();
  }, 30_000);
});

describe('the playout’s clips (RG at the studio, Nov 11, 2026)', () => {
  it('gives the playout a cue’s new file, though its name is the same', () => {
    const before = [{ name: 'A10_L3_STUDIO TOUR', path: '/Volumes/USB/A10_L3_STUDIO TOUR.mov' }];
    const after = [{ name: 'A10_L3_STUDIO TOUR', path: '/Volumes/USB 2/A10_L3_STUDIO TOUR.mov' }];
    // Live mode: the playout was given the first file, so it's given the new one.
    expect(playlistUpToDate(before, ['A10_L3_STUDIO TOUR'], ['/Volumes/USB/A10_L3_STUDIO TOUR.mov'])).toBe(true);
    expect(playlistUpToDate(after, ['A10_L3_STUDIO TOUR'], ['/Volumes/USB/A10_L3_STUDIO TOUR.mov'])).toBe(false);
    // The simulator's DDR 2 goes by name only.
    expect(playlistUpToDate(after, ['A10_L3_STUDIO TOUR'], null)).toBe(true);
    expect(playlistUpToDate(after, ['Something else'], null)).toBe(false);
  });
});
