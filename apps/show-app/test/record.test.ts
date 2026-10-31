// Record (Phase 5): the producer names each recording and picks its folder (RG, Oct 30, 2026), with
// Show_Episode_Date.mp4 suggested, in the folder used last time.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_SHOW_SETTINGS } from '@tstv/shared';
import { Runtime } from '../src/main/runtime.ts';
import { Store } from '../src/main/store.ts';

let folder: string;
beforeAll(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), 'tstv-record-'));
});
afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});

/** The app, pretending to be in live mode, answering the save window with answer. */
function app(answer: (suggested: string) => string | null) {
  const asked: string[] = [];
  const recorded: string[] = [];
  const runtime = new Runtime({
    store: new Store(path.join(folder, 'app')),
    pickFiles: async () => [],
    pickFile: async () => null,
    recordingsFolder: path.join(folder, 'Movies'),
    pickRecording: async (suggested) => {
      asked.push(suggested);
      return answer(suggested);
    },
  });
  Object.assign(runtime.website, { show: { id: 'show1', name: 'TSTV News PrimeTime', settings: DEFAULT_SHOW_SETTINGS }, episode: { id: 'ep1', title: 'Oct 30 PrimeTime', airDate: '2026-10-30', airTime: '' } });
  Object.assign(runtime, {
    feeds: { recording: { file: null, error: null }, error: null, url: () => null, record: (file: string) => recorded.push(file), stopRecording: () => undefined, close: async () => undefined },
  });
  return { runtime, asked, recorded };
}

describe('naming a recording', () => {
  it('suggests Show_Episode_Date.mp4, and records under the name the producer types, as an MP4', async () => {
    const { runtime, asked, recorded } = app((suggested) => path.join(path.dirname(suggested), 'Homecoming special'));
    await runtime.act({ kind: 'record', on: true });
    expect(asked).toEqual([path.join(folder, 'Movies', 'TSTV-News-PrimeTime_Oct-30-PrimeTime_2026-10-30.mp4')]);
    expect(recorded).toEqual([path.join(folder, 'Movies', 'Homecoming special.mp4')]);
    runtime.close();
  });

  it('starts in the folder used last time, never suggests an earlier recording’s name, and records nothing when cancelled', async () => {
    const shows = path.join(folder, 'Shows');
    await mkdir(shows, { recursive: true });
    const answers = [path.join(shows, 'First.mp4'), null];
    const { runtime, asked, recorded } = app(() => answers.shift() ?? null);
    await runtime.act({ kind: 'record', on: true });
    await writeFile(path.join(shows, 'TSTV-News-PrimeTime_Oct-30-PrimeTime_2026-10-30.mp4'), '');
    await runtime.act({ kind: 'record', on: true });
    expect(asked[1]).toBe(path.join(shows, 'TSTV-News-PrimeTime_Oct-30-PrimeTime_2026-10-30_2.mp4'));
    expect(recorded).toEqual([path.join(shows, 'First.mp4')]);
    runtime.close();
  });
});
