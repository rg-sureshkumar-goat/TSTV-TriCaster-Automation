// Open On Manual Mode (RG, Nov 2, 2026): RiGster runs the TC1 by hand, with no rundown, prompter or key.
// Graphics fire in the order imported (or dragged into), stay up until taken off, and are kept for next
// time; the green screen can be one of the shows'. The simulator stands in for the TC1.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';
import { startSimulator, type RunningSimulator } from '../../../tools/simulator/src/server.ts';
import { Runtime } from '../src/main/runtime.ts';
import { Store } from '../src/main/store.ts';

const run = promisify(execFile);
let sim: RunningSimulator;
let folder: string;
let runtime: Runtime;

async function makeClip(name: string, seconds: number): Promise<string> {
  const file = path.join(folder, 'usb', name);
  await run(ffmpegStatic as unknown as string, ['-v', 'error', '-f', 'lavfi', '-i', `color=c=green:s=160x90:d=${seconds}`, '-pix_fmt', 'yuv420p', '-y', file]);
  return file;
}

const waitFor = async (check: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 25));
  }
};

const ddr2 = () => sim.switcher.snapshot().players.ddr2;
const dskOn = () => sim.switcher.snapshot().dsks.main_dsk2.onAir;
const clipOnAir = () => (dskOn() ? ddr2().playlist[ddr2().index]?.name : null);
const labels = () => runtime.state().sections.flatMap((s) => s.elements.map((e) => e.label));

async function laptop(): Promise<Runtime> {
  const store = new Store(path.join(folder, 'app'));
  await store.saveSettings({ ...(await store.settings()), simulatorAddress: `127.0.0.1:${sim.httpPort}` });
  // A show's green screen, already on this laptop.
  await store.saveGreenScreen('show1', { path: path.join(folder, 'usb', 'Studio.mp4'), seconds: 1, thumbnail: null });
  const r = new Runtime({ store, pickFiles: async () => [], pickFile: async () => null });
  await r.connectSwitcher(`127.0.0.1:${sim.httpPort}`, sim.statePort);
  return r;
}

beforeAll(async () => {
  sim = await startSimulator({ httpPort: 0, statePort: 0 });
  folder = await mkdtemp(path.join(os.tmpdir(), 'tstv-manual-'));
  await mkdir(path.join(folder, 'usb'));
  await Promise.all([makeClip('Title.mp4', 1.5), makeClip('Lower Third.mp4', 3), makeClip('Credits.mp4', 0.6), makeClip('Studio.mp4', 1)]);
  runtime = await laptop();
}, 60_000);

afterAll(async () => {
  runtime?.close();
  await sim?.close();
  await rm(folder, { recursive: true, force: true, maxRetries: 5 });
});

describe('Open On Manual Mode', () => {
  it('opens with no episode, in manual mode, with the three cameras and nothing from a show profile', async () => {
    await runtime.act({ kind: 'openManual' });
    const s = runtime.state();
    expect(s).toMatchObject({ manualSession: true, profilePicked: true, episode: null, profile: null, permanent: [], musicTrack: null });
    expect(s.automation.manual).toBe(true);
    expect(s.cameras.map((c) => c.input)).toEqual([1, 2, 3]);
    // Manual Mode can't be switched back to automation.
    await runtime.act({ kind: 'setManual', manual: false });
    expect(runtime.state().automation.manual).toBe(true);
  });

  it('puts imported graphics in the Playlist in the order imported, and DDR 2 gets them', async () => {
    await runtime.act({ kind: 'addFiles', paths: [path.join(folder, 'usb', 'Title.mp4'), path.join(folder, 'usb', 'Lower Third.mp4')] });
    await runtime.act({ kind: 'addFiles', paths: [path.join(folder, 'usb', 'Credits.mp4'), path.join(folder, 'usb', 'Title.mp4')] });
    expect(labels()).toEqual(['Title', 'Lower Third', 'Credits']);
    await waitFor(() => ddr2().playlist.map((c) => c.name).join() === 'Title,Lower Third,Credits');
  });

  it('drags a graphic to another place', async () => {
    const ids = runtime.state().sections[0].elements.map((e) => e.id);
    await runtime.act({ kind: 'moveManual', elementId: ids[2], before: ids[0] });
    expect(labels()).toEqual(['Credits', 'Title', 'Lower Third']);
    await waitFor(() => ddr2().playlist.map((c) => c.name).join() === 'Credits,Title,Lower Third');
    await runtime.act({ kind: 'moveManual', elementId: ids[2], before: null });
    expect(labels()).toEqual(['Title', 'Lower Third', 'Credits']);
    await waitFor(() => ddr2().playlist.map((c) => c.name).join() === 'Title,Lower Third,Credits');
  });

  it('fires graphics by hand, keeps each up after its clip ends, and takes cameras by hand', async () => {
    await runtime.act({ kind: 'takeCamera', input: 2 });
    await waitFor(() => sim.switcher.snapshot().mes.v1.a === 'input2');
    await waitFor(() => runtime.state().automation.upNext[0]?.ddrItem !== null);
    await runtime.act({ kind: 'fireNext' });
    await waitFor(() => clipOnAir() === 'Title');
    // The clip ends, and it stays up.
    await new Promise((r) => setTimeout(r, 2000));
    expect(dskOn()).toBe(true);
    expect(runtime.state().automation.onAir?.label).toBe('Title');
    await runtime.act({ kind: 'takeOff' });
    await waitFor(() => !dskOn());
    expect(runtime.state().automation.upNext[0]?.label).toBe('Lower Third');
  });

  it('pauses a graphic where it is with Space, and starts it again', async () => {
    await waitFor(() => runtime.state().automation.upNext[0]?.label === 'Lower Third');
    await runtime.act({ kind: 'fireNext' });
    await waitFor(() => clipOnAir() === 'Lower Third' && ddr2().playing);
    await new Promise((r) => setTimeout(r, 200));
    await runtime.act({ kind: 'pauseGraphic' });
    expect(runtime.state().switcher.ddrPaused).toBe(true);
    await waitFor(() => !ddr2().playing);
    // Still up, and it stays where it is for longer than the clip has left.
    const place = ddr2().positionMs;
    await new Promise((r) => setTimeout(r, 300));
    expect(ddr2().positionMs).toBe(place);
    expect(dskOn()).toBe(true);
    expect(runtime.state().automation.onAir?.label).toBe('Lower Third');
    await runtime.act({ kind: 'pauseGraphic' });
    expect(runtime.state().switcher.ddrPaused).toBe(false);
    await waitFor(() => ddr2().playing);
    // Pausing again, then taking it off, leaves nothing paused for the next one.
    await runtime.act({ kind: 'pauseGraphic' });
    await runtime.act({ kind: 'takeOff' });
    await waitFor(() => !dskOn());
    expect(runtime.state().switcher.ddrPaused).toBe(false);
    // With nothing on air, there's nothing to pause.
    await runtime.act({ kind: 'pauseGraphic' });
    expect(runtime.state().switcher.ddrPaused).toBe(false);
  });

  it('uses a show’s green screen, as its own', async () => {
    expect(runtime.state().greenScreen).toBeNull();
    await runtime.act({ kind: 'useShowGreenScreen', showId: 'show1' });
    expect(runtime.state().greenScreen?.file).toBe('Studio.mp4');
    // Removing it from Manual Mode leaves the show's alone.
    await runtime.act({ kind: 'clearGreenScreen' });
    expect(await new Store(path.join(folder, 'app')).greenScreen('show1')).not.toBeNull();
    await runtime.act({ kind: 'useShowGreenScreen', showId: 'show1' });
  });

  it('takes a new green screen dropped on its box, and the switcher gets it', async () => {
    await runtime.act({ kind: 'setGreenScreen', path: path.join(folder, 'usb', 'Credits.mp4') });
    expect(runtime.state().greenScreen?.file).toBe('Credits.mp4');
    await waitFor(() => sim.switcher.snapshot().players.ddr1.playlist.map((c) => c.name).join() === 'Credits');
    await runtime.act({ kind: 'useShowGreenScreen', showId: 'show1' });
  });

  it('keeps its graphics and green screen for next time, until Clear', async () => {
    runtime.close();
    runtime = await laptop();
    await runtime.act({ kind: 'openManual' });
    expect(labels()).toEqual(['Title', 'Lower Third', 'Credits']);
    expect(runtime.state().greenScreen?.file).toBe('Studio.mp4');
    await runtime.act({ kind: 'clearManual' });
    expect(labels()).toEqual([]);
  });

  it('leaves Manual Mode when a show profile is picked', async () => {
    await runtime.act({ kind: 'setProfile', showId: 'show1' });
    expect(runtime.state().manualSession).toBe(false);
    expect(runtime.state().profile).toBeNull(); // Not listed (no website here), but picked.
    expect((await new Store(path.join(folder, 'app')).settings()).profileShowId).toBe('show1');
  });
});
