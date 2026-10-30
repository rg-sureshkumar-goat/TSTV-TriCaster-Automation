// Live mode's driver (Phase 5), at home: a simulator pretending to be the TC1 stands in for the switcher,
// and a stand-in playout records what it's asked to do.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { startSimulator, type RunningSimulator } from '../../../tools/simulator/src/server.ts';
import { Switcher } from '../src/main/switcher.ts';
import type { Playout } from '../src/main/playout.ts';

/** Records the playout's calls, and can say a clip ended. */
class FakePlayout extends EventEmitter {
  calls: string[] = [];
  state = { item: null, playing: false, remaining: null, musicPlaying: false, connections: 1, level: -60, error: null };
  setPlaylist(clips: { name: string; path: string }[]) {
    this.calls.push(`playlist ${clips.map((c) => `${c.name}=${c.path}`).join(',')}`);
  }
  select(item: number) {
    this.calls.push(`select ${item}`);
  }
  play() {
    this.calls.push('play');
  }
  stop() {
    this.calls.push('stop');
  }
  music(play: boolean, path?: string) {
    this.calls.push(`music ${play} ${path ?? ''}`.trim());
  }
}

let sim: RunningSimulator;
const original = global.fetch;
const waitFor = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
};
const commands = () => sim.externalCommands().map((c) => `${c.name} ${c.value ?? ''}`.trim());

/** The simulator calls itself the TC1 from now on. */
function pretendToBeTc1() {
  global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const response = await original(input, init);
    if (String(input).endsWith('/v1/version')) return new Response((await response.text()).replace('TSTV Simulator', 'TriCaster TC1'));
    return response;
  }) as typeof fetch;
}

beforeAll(async () => {
  sim = await startSimulator({ httpPort: 0, statePort: 0 });
});
afterEach(() => {
  global.fetch = original;
});
afterAll(async () => {
  await sim?.close();
});

describe('live mode’s driver', () => {
  it('refuses the simulator: live mode only talks to a TriCaster TC1', async () => {
    const switcher = new Switcher(`127.0.0.1:${sim.httpPort}`, sim.statePort, 'live', new FakePlayout() as unknown as Playout);
    await switcher.connect();
    expect(switcher.snapshot.status).toBe('refused');
    expect(switcher.snapshot.error).toContain('TriCaster TC1');
    switcher.close();
  });

  it('sends cameras and DSK 2 to the TC1, and the clips and music to the playout', async () => {
    pretendToBeTc1();
    const playout = new FakePlayout();
    const switcher = new Switcher(`127.0.0.1:${sim.httpPort}`, sim.statePort, 'live', playout as unknown as Playout);
    await switcher.connect();
    expect(switcher.snapshot.status).toBe('connected');
    const ddr2Before = sim.switcher.snapshot().players.ddr2.playlist.length;

    await switcher.loadPlaylist([
      { name: 'A1_L3_Score', durationMs: 20_000, path: '/usb/A1_L3_Score.mov' },
      { name: 'A2_SOT_Coach', durationMs: 30_000, path: '/usb/A2_SOT_Coach.mov' },
    ]);
    await switcher.loadPlaylist([{ name: 'News Music', durationMs: 60_000, path: '/usb/News Music.mp3' }], 'sound');
    expect(switcher.snapshot.playlist).toEqual(['A1_L3_Score', 'A2_SOT_Coach']);
    // Nothing went to the TC1's DDR 2.
    expect(sim.switcher.snapshot().players.ddr2.playlist.length).toBe(ddr2Before);

    const before = sim.externalCommands().length;
    await switcher.run([{ kind: 'camera', input: 2 }, { kind: 'cueClip', item: 1 }, { kind: 'dsk', on: true }, { kind: 'music', play: true, track: 0 }]);
    await switcher.run([{ kind: 'cueClip', item: 0 }, { kind: 'play' }, { kind: 'dsk', on: false }, { kind: 'music', play: false }]);
    expect(commands().slice(before)).toEqual(['v1_a_row_named_input INPUT2', 'main_dsk2_value 1', 'main_dsk2_value 0']);
    expect(playout.calls).toEqual([
      'playlist A1_L3_Score=/usb/A1_L3_Score.mov,A2_SOT_Coach=/usb/A2_SOT_Coach.mov',
      'select 1',
      'play',
      'music true /usb/News Music.mp3',
      'select 0',
      'play',
      'stop',
      'music false /usb/News Music.mp3',
    ]);
    switcher.close();
  });

  it('reports a clip that ends while DSK 2 is on, by its item', async () => {
    pretendToBeTc1();
    const playout = new FakePlayout();
    const switcher = new Switcher(`127.0.0.1:${sim.httpPort}`, sim.statePort, 'live', playout as unknown as Playout);
    await switcher.connect();
    const ended: (number | null)[] = [];
    switcher.on('clipEnded', (item: number | null) => ended.push(item));
    playout.emit('ended', 1);
    expect(ended).toEqual([]);
    await switcher.run([{ kind: 'dsk', on: true }]);
    await waitFor(() => switcher.snapshot.dskOn);
    playout.emit('ended', 1);
    expect(ended).toEqual([1]);
    await switcher.run([{ kind: 'dsk', on: false }]);
    switcher.close();
  });
});
