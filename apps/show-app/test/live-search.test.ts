// Turning on live mode (RG, Nov 1, 2026): RiGster waits for the cable and the TC1, says what it's waiting
// for, keeps trying until it connects, and stops when the producer cancels.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { answersPing, Runtime } from '../src/main/runtime.ts';
import { Store } from '../src/main/store.ts';

let folder: string;
beforeAll(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), 'tstv-live-search-'));
});
afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});

const waitFor = async (check: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe('turning on live mode', () => {
  it('waits for the cable, saying so, and stops when cancelled', async () => {
    const runtime = new Runtime({ store: new Store(path.join(folder, 'app')), pickFiles: async () => [], pickFile: async () => null, cable: () => [] });
    await runtime.act({ kind: 'setLiveMode', on: true });
    await waitFor(() => runtime.state().liveWaiting?.includes('cable') === true);
    expect(runtime.state().mode).toBe('simulator');
    expect(runtime.state().liveError).toBeNull();
    // Clicking it again doesn't start a second search.
    await runtime.act({ kind: 'setLiveMode', on: true });
    await runtime.act({ kind: 'setLiveMode', on: false });
    expect(runtime.state().liveWaiting).toBeNull();
    expect(runtime.state().mode).toBe('simulator');
    runtime.close();
  });

  it('tells whether a computer answers a ping, from a given address', async () => {
    expect(await answersPing('127.0.0.1', ['127.0.0.1'])).toBe(true);
    // A documentation-only address nothing answers from.
    expect(await answersPing('192.0.2.1', ['127.0.0.1'])).toBe(false);
  }, 15_000);
});
