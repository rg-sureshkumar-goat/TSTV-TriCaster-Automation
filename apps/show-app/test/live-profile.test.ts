// With the cable already in, RiGster can connect to the TC1 while the show profile is still loading. The
// profile's green screen and transitions have to reach the playout and switcher anyway (RG, Nov 4, 2026).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Runtime } from '../src/main/runtime.ts';
import { Store } from '../src/main/store.ts';

const backgrounds = vi.hoisted(() => [] as (string | null)[]);
vi.mock('../src/main/playout.ts', async () => {
  const { EventEmitter } = await import('node:events');
  class Playout extends EventEmitter {
    state = { item: null, playing: false, paused: false, remaining: null, musicPlaying: false, connections: 0, level: -60, error: null };
    fader() {}
    background(file: string | null) {
      backgrounds.push(file);
    }
    upNext() {}
    close() {}
  }
  return { Playout };
});
vi.mock('../src/main/feeds.ts', async () => {
  const { EventEmitter } = await import('node:events');
  class Feeds extends EventEmitter {
    stopRecording() {}
    close() {}
  }
  return { Feeds };
});

let folder: string;
beforeAll(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), 'tstv-live-profile-'));
});
afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe('connecting to the TC1 while the show profile loads', () => {
  it('sends the profile’s green screen and transitions once it’s connected', async () => {
    const runtime = new Runtime({ store: new Store(path.join(folder, 'app')), pickFiles: async () => [], pickFile: async () => null, alwaysLive: true });
    // What the profile loads, part way through connecting.
    const live = {
      snapshot: { status: 'off', playlist: [], soundTracks: [], programInput: null, dskOn: false, layoutOn: false },
      transitions: {} as Record<string, unknown>,
      mode: 'live',
      async connect() {
        const r = runtime as unknown as { greenScreen: unknown; transitions: unknown };
        r.greenScreen = { path: '/profile/Background.png', seconds: null };
        r.transitions = { tease: { path: '/profile/Wipe.mov' } };
        this.snapshot.status = 'connected';
      },
      close() {},
      showUpNext() {},
      loadPlaylist: async () => undefined,
      run: async () => undefined,
    };
    const inner = runtime as unknown as { newSwitcher: () => unknown; liveWaiting: string | null; goLive: (at: { address: string; localAddress: string }) => Promise<boolean>; switcher: { close(): void }; playout: unknown };
    inner.newSwitcher = () => live;
    inner.liveWaiting = 'Connecting…';
    expect(await inner.goLive({ address: '169.254.0.1', localAddress: '169.254.0.2' })).toBe(true);
    expect(backgrounds.at(-1)).toBe('/profile/Background.png');
    expect(live.transitions).toEqual({ tease: { path: '/profile/Wipe.mov' } });
    (inner as unknown as { playout: null }).playout = null;
    runtime.close();
  });
});
