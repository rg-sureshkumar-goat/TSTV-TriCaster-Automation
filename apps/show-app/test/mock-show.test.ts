// A mock show: the show app's core, with real (tiny) clips made by FFmpeg, runs the simulator from a
// rundown and the prompter's cues, following the brief's cue rules.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import * as Y from 'yjs';
import ffmpegStatic from 'ffmpeg-static';
import { addElement, DEFAULT_SHOW_SETTINGS, insertBlock, insertSection, readBroadcast, setBroadcast, type ShowSettings } from '@tstv/shared';
import { startSimulator, type RunningSimulator } from '../../../tools/simulator/src/server.ts';
import { Runtime } from '../src/main/runtime.ts';
import { Store } from '../src/main/store.ts';

const run = promisify(execFile);
const alex = { id: 'u1', name: 'Alex Producer' };

let sim: RunningSimulator;
let folder: string;
let runtime: Runtime;
let doc: Y.Doc;
const ids: Record<string, string> = {};

/** A solid-color test clip of the given length. */
async function makeClip(name: string, seconds: number): Promise<void> {
  await run(ffmpegStatic as unknown as string, ['-v', 'error', '-f', 'lavfi', '-i', `color=c=blue:s=160x90:d=${seconds}`, '-pix_fmt', 'yuv420p', '-y', path.join(folder, 'usb', name)]);
}

const waitFor = async (check: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 25));
  }
};

const state = () => sim.switcher.snapshot();
const ddr2 = () => state().players.ddr2;
const clipOnAir = () => (state().dsks.main_dsk2.onAir ? ddr2().playlist[ddr2().index]?.name : null);

beforeAll(async () => {
  sim = await startSimulator({ httpPort: 0, statePort: 0 });
  folder = await mkdtemp(path.join(os.tmpdir(), 'tstv-show-app-'));
  await mkdir(path.join(folder, 'usb'));
  await Promise.all([makeClip('A1_TEASE_Sports.mp4', 1.2), makeClip('A3_L3_Score.mp4', 4), makeClip('A3_VO_Highlights.mp4', 1.2), makeClip('A4_SOT_Coach.mp4', 1.2), makeClip('Show Intro.mov', 1)]);

  // The episode, as the website would send it.
  doc = new Y.Doc();
  insertBlock(doc, alex);
  ids.a1 = insertSection(doc, alex, { slug: 'Sports Tease', type: 'Tease' });
  ids.a2 = insertSection(doc, alex, { slug: 'Open', type: 'Permanent Graphic' });
  ids.a3 = insertSection(doc, alex, { slug: 'Score', type: 'Reader', camera: 'Camera 2' });
  ids.a4 = insertSection(doc, alex, { slug: 'Coach', type: 'SOT' });
  ids.tease = addElement(doc, ids.a1, 'TEASE', alex)!;
  ids.intro = addElement(doc, ids.a2, 'PERM', alex, 'Show Intro')!;
  ids.l3 = addElement(doc, ids.a3, 'L3', alex, 'Score')!;
  ids.vo = addElement(doc, ids.a3, 'VO', alex, 'Highlights')!;
  ids.sot = addElement(doc, ids.a4, 'SOT', alex)!;

  runtime = new Runtime({ store: new Store(path.join(folder, 'app')), pickFiles: async () => [], pickFile: async () => null });
  await runtime.connectSwitcher(`127.0.0.1:${sim.httpPort}`, sim.statePort);
  const settings: ShowSettings = { ...DEFAULT_SHOW_SETTINGS };
  Object.assign(runtime.website, { doc, status: 'connected', show: { id: 'show1', name: 'PrimeTime', settings }, episode: { id: 'ep1', title: 'Mock show', airDate: '', airTime: '' } });
  runtime.website.emit('rundown');
}, 60_000);

afterAll(async () => {
  runtime?.close();
  await sim?.close();
  await rm(folder, { recursive: true, force: true });
});

const cue = (kind: 'section' | 'cue', id: string) =>
  runtime.website.emit('cue', kind === 'section' ? { kind, sectionId: id, at: Date.now() } : { kind, sectionId: '', elementId: id, at: Date.now() });

describe('a mock show on the simulator', () => {
  it('imports the graphics by name, and asks about the one that doesn’t follow the pattern', async () => {
    await runtime.act({ kind: 'addFiles', paths: [path.join(folder, 'usb')] });
    const s = runtime.state();
    const files = Object.fromEntries(s.sections.flatMap((x) => x.elements).map((e) => [e.id, e.file]));
    expect(files[ids.tease]).toBe('A1_TEASE_Sports.mp4');
    expect(files[ids.vo]).toBe('A3_VO_Highlights.mp4');
    expect(s.sections.flatMap((x) => x.elements).find((e) => e.id === ids.vo)?.seconds).toBeCloseTo(1.2, 1);
    expect(s.sections.flatMap((x) => x.elements).find((e) => e.id === ids.l3)?.thumbnail).toMatch(/^data:image\/jpeg;base64,/);
    // "Show Intro.mov" isn't named like a section's file: the producer puts it on the permanent graphic.
    expect(s.problems.map((p) => p.name)).toEqual(['Show Intro.mov']);
    expect(s.problems[0].candidates.map((c) => c.id)).toContain(ids.intro);
    await runtime.act({ kind: 'assign', path: s.problems[0].path, elementId: ids.intro });
    expect(runtime.state().problems).toEqual([]);
  }, 30_000);

  it('makes a copy of each file that the Program box can play', async () => {
    const withFiles = () => runtime.state().sections.flatMap((x) => x.elements).filter((e) => e.file);
    await waitFor(() => withFiles().every((e) => e.playable), 30_000);
    expect(withFiles().map((e) => e.playable)).toEqual(expect.arrayContaining([expect.stringMatching(/^file:.*\.webm$/)]));
  }, 40_000);

  it('keeps the simulator’s DDR 2 loaded in rundown order, with the break clip at the top of the block', async () => {
    await waitFor(() => runtime.state().switcher.playlist.length === 6);
    expect(ddr2().playlist.map((c) => c.name)).toEqual(['TSTV Ident 2022 News', 'A1_TEASE_Sports', 'Show Intro', 'A3_L3_Score', 'A3_VO_Highlights', 'A4_SOT_Coach']);
    expect(runtime.state().sections.flatMap((x) => x.elements).every((e) => e.ddrItem !== null)).toBe(true);
  });

  it('ignores the prompter until the producer starts the live broadcast', async () => {
    const before = sim.externalCommands().length;
    cue('section', ids.a1);
    cue('cue', ids.tease);
    await new Promise((r) => setTimeout(r, 300));
    expect(sim.externalCommands().length).toBe(before);
    expect(runtime.state().live.on).toBe(false);
    // The producer's own buttons work before going live.
    await runtime.act({ kind: 'takeCamera', input: 2 });
    await waitFor(() => state().mes.v1.a === 'input2');
    // Start live broadcast (the website asks the episode room, which sets it in the episode).
    setBroadcast(doc, true, alex);
    runtime.website.emit('broadcast', readBroadcast(doc));
    expect(runtime.state().live.on).toBe(true);
    expect(runtime.state().clock.startedAt).not.toBeNull();
  });

  it('runs the tease with music, the intro, the L3 and VO, and the SOT, by the cue rules', async () => {
    // A1 starts: camera 1, the tease is cued, and the music starts.
    cue('section', ids.a1);
    await waitFor(() => state().mes.v1.a === 'input1' && state().players.sound.playing && ddr2().index === 1);
    cue('cue', ids.tease);
    await waitFor(() => clipOnAir() === 'A1_TEASE_Sports');
    // A2 starts: the tease (a voiceover) comes off; the intro fires and the music stops just before it.
    cue('section', ids.a2);
    await waitFor(() => !state().dsks.main_dsk2.onAir);
    cue('cue', ids.intro);
    await waitFor(() => clipOnAir() === 'Show Intro' && !state().players.sound.playing);
    // The intro has its own audio, so A3 starting doesn't cut it off. It ends by itself, and DSK 2 goes off.
    cue('section', ids.a3);
    await waitFor(() => state().mes.v1.a === 'input2');
    expect(clipOnAir()).toBe('Show Intro');
    await waitFor(() => !state().dsks.main_dsk2.onAir, 4000);
    // The L3, then the VO over it; when the VO ends first, the L3 comes back.
    cue('cue', ids.l3);
    await waitFor(() => clipOnAir() === 'A3_L3_Score');
    cue('cue', ids.vo);
    await waitFor(() => clipOnAir() === 'A3_VO_Highlights');
    await waitFor(() => clipOnAir() === 'A3_L3_Score', 4000);
    // A4: the L3 comes off; the SOT plays to its end, then back to the anchors.
    cue('section', ids.a4);
    await waitFor(() => !state().dsks.main_dsk2.onAir && state().mes.v1.a === 'input1');
    cue('cue', ids.sot);
    await waitFor(() => clipOnAir() === 'A4_SOT_Coach');
    await waitFor(() => !state().dsks.main_dsk2.onAir, 4000);
    expect(runtime.state().lastCue?.label).toBe('Take SOT (A4)');
  }, 30_000);

  it('in manual mode, fires only what the producer presses, and Continue hands the show back to the prompter', async () => {
    await runtime.act({ kind: 'setManual', manual: true });
    expect(runtime.state().automation.manual).toBe(true);
    const before = sim.externalCommands().length;
    cue('section', ids.a1);
    cue('cue', ids.tease);
    await new Promise((r) => setTimeout(r, 300));
    expect(sim.externalCommands().length).toBe(before);
    // Left arrow twice, from the SOT: the VO, then the L3, go up again. Down arrow takes the L3 off.
    await runtime.act({ kind: 'fireBack' });
    await waitFor(() => clipOnAir() === 'A3_VO_Highlights');
    await runtime.act({ kind: 'fireBack' });
    await waitFor(() => clipOnAir() === 'A3_L3_Score');
    await runtime.act({ kind: 'takeOff' });
    await waitFor(() => !state().dsks.main_dsk2.onAir);
    // A click on a camera takes it.
    await runtime.act({ kind: 'takeCamera', input: 3 });
    await waitFor(() => state().mes.v1.a === 'input3');
    // Continue: up next is from the prompter's place (after A1's tease), and its next section takes its camera.
    await runtime.act({ kind: 'setManual', manual: false });
    expect(runtime.state().automation.upNext[0].id).toBe(ids.intro);
    cue('section', ids.a2);
    await waitFor(() => state().mes.v1.a === 'input1');
  });

  it('plays the music track the producer dropped on the Music box', async () => {
    const file = path.join(folder, 'usb', 'Show Music 2026.wav');
    await run(ffmpegStatic as unknown as string, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-y', file]);
    await runtime.act({ kind: 'setMusicTrack', path: file });
    expect(runtime.state().musicTrack).toMatchObject({ file: 'Show Music 2026.wav', seconds: 3 });
    // On the simulator, it's put in the Sound player…
    expect(state().players.sound.playlist.map((c) => c.name)).toEqual(['Show Music 2026']);
    await waitFor(() => runtime.state().musicTrack?.inSoundPlayer === true);
    // …and the show's music cue now points at that track, so that's the one that plays.
    const track = runtime.engine!.plan.music.track;
    expect(runtime.state().switcher.soundTracks[track]).toBe('Show Music 2026');
    await runtime.switcher.run([{ kind: 'music', play: true, track }]);
    await waitFor(() => state().players.sound.playing);
    expect(state().players.sound.playlist[state().players.sound.index].name).toBe('Show Music 2026');
  });

  it('takes the show’s permanent graphics and green screen by dropping files', async () => {
    await makeClip('PrimeTime Station ID.mov', 1);
    await makeClip('Studio background.mp4', 1);
    await runtime.act({ kind: 'addPermanent', paths: [path.join(folder, 'usb', 'PrimeTime Station ID.mov')] });
    expect(runtime.state().permanent.find((g) => g.name === 'Station ID')?.file).toBe('PrimeTime Station ID.mov');
    await runtime.act({ kind: 'setGreenScreen', path: path.join(folder, 'usb', 'Studio background.mp4') });
    expect(runtime.state().greenScreen?.file).toBe('Studio background.mp4');
    // On the simulator, a clip background goes in DDR 1.
    expect(state().players.ddr1.playlist.map((c) => c.name)).toEqual(['Studio background']);
  });

  it('stops following the prompter when the live broadcast ends', async () => {
    setBroadcast(doc, false, alex);
    runtime.website.emit('broadcast', readBroadcast(doc));
    const before = sim.externalCommands().length;
    cue('section', ids.a3);
    await new Promise((r) => setTimeout(r, 300));
    expect(sim.externalCommands().length).toBe(before);
  });

  it('refuses to talk to anything that isn’t the simulator', async () => {
    const realOne = await startSimulator({ httpPort: 0, statePort: 0 });
    // Pretend the second one is the real TC1 by changing what it calls itself.
    const original = global.fetch;
    global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const response = await original(input, init);
      if (String(input).endsWith('/v1/version')) return new Response((await response.text()).replace('TSTV Simulator', 'TriCaster TC1'));
      return response;
    }) as typeof fetch;
    try {
      await runtime.connectSwitcher(`127.0.0.1:${realOne.httpPort}`, realOne.statePort);
      expect(runtime.state().switcher.status).toBe('refused');
      await runtime.act({ kind: 'takeCamera', input: 2 });
      expect(realOne.externalCommands()).toEqual([]);
    } finally {
      global.fetch = original;
      await realOne.close();
    }
  });
});
