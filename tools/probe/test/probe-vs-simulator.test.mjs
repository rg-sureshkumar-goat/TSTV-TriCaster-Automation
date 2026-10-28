// Runs the real probe against the simulator and proves two things: it learns what the "TC1" offers,
// and the simulator receives zero commands from it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runProbe } from '../lib/run.mjs';
import { startSimulator } from '../../simulator/src/server.ts';

/** @type {Awaited<ReturnType<typeof startSimulator>>} */
let sim;
/** @type {string} */
let outDir;

beforeEach(async () => {
  sim = await startSimulator({ httpPort: 0, statePort: 0 });
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tstv-probe-test-'));
});

afterEach(async () => {
  await sim.close();
  fs.rmSync(outDir, { recursive: true, force: true });
});

const probe = (extra = {}) =>
  runProbe({ host: '127.0.0.1', httpPort: sim.httpPort, statePort: sim.statePort, listenSeconds: 2, interactive: false, outDir, log: () => {}, ...extra });

describe('probe against the simulator', () => {
  it('reads the simulated TC1 and sends no commands', async () => {
    // Once the probe is listening, the "TD" turns DSK 2 on at the panel.
    const { results, files } = await probe({
      log: (/** @type {string} */ line) => {
        if (line.includes('Listening for')) setTimeout(() => sim.switcher.command('panel', 'main_dsk2_take'), 200);
      },
    });

    expect(results.http.requests['/v1/version'].status).toBe(200);
    expect(results.http.requests['/v1/version'].body).toContain('TSTV Simulator');
    expect(results.stateStream.connected).toBe(true);
    expect(results.stateStream.build.product).toBe('TSTV Simulator');
    expect(results.stateStream.states.main_dsk2_value).toBeDefined();
    expect(results.stateStream.changes).toContainEqual(expect.objectContaining({ name: 'main_dsk2_value', value: '1' }));
    expect(results.notifications.upgraded).toBe(true);
    // The TC1 ends notifications with a null character; the probe records them without it.
    expect(results.notifications.nullTerminated).toBe(true);
    expect(results.notifications.messages.map((/** @type {any} */ m) => m.text)).toContain('tally');
    expect(Object.keys(results.http.notificationReads)).toContain('tally');
    expect(results.answers.find((/** @type {any} */ a) => a.id === 'interface').answer).toBe('Yes');

    expect(fs.existsSync(files.json)).toBe(true);
    expect(fs.readFileSync(files.summary, 'utf8')).toContain('It sent no commands');

    // The point of the whole test:
    expect(sim.externalCommands()).toEqual([]);
  });

  it('notices a LivePanel password, carries on, and still sends no commands', async () => {
    sim.faults.password = 'secret';
    const { results } = await probe();
    expect(results.http.requests['/v1/version'].status).toBe(401);
    expect(results.http.authChallenge).toContain('Basic');
    expect(results.stateStream.connected).toBe(true);
    expect(sim.externalCommands()).toEqual([]);
  });

  it('uses a typed password when one is given', async () => {
    sim.faults.password = 'secret';
    const { results } = await probe({ interactive: true, guided: false, ask: async () => '', askHidden: async () => 'secret' });
    expect(results.http.requests['/v1/version'].status).toBe(200);
    expect(results.http.authUsed).toBe('Basic');
    expect(results.notifications.upgraded).toBe(true);
    expect(sim.externalCommands()).toEqual([]);
  });

  it('records the guided panel steps', async () => {
    const replies = ['', '', 's', 's', 's', 's', 's', 's'];
    let step = 0;
    const { results } = await probe({
      interactive: true,
      ask: async () => {
        // Step 2 is "take a different camera": do it on the simulated panel before answering.
        // On TSTV's TC1 cameras are switched on M/E 1, which is on program.
        if (step === 0) sim.switcher.command('panel', 'v1_a_row', 'INPUT2');
        if (step === 1) sim.switcher.command('panel', 'main_dsk2_take');
        return replies[step++] ?? 's';
      },
    });
    const camera = results.guidedSteps.find((/** @type {any} */ s) => s.id === 'camera');
    expect(camera.changedStates.v1_a_row_named_input).toEqual({ from: 'INPUT1', to: 'INPUT2' });
    const dsk = results.guidedSteps.find((/** @type {any} */ s) => s.id === 'dsk2');
    expect(Object.keys(dsk.changedStates)).toContain('main_dsk2_value');
    expect(sim.externalCommands()).toEqual([]);
  }, 40_000);

  it('saves results when nothing answers', async () => {
    const { results } = await runProbe({ host: '127.0.0.1', httpPort: 1, statePort: 2, listenSeconds: 1, interactive: false, outDir, log: () => {} });
    expect(results.answers.find((/** @type {any} */ a) => a.id === 'reach').answer).toBe('No');
    expect(results.answers.find((/** @type {any} */ a) => a.id === 'interface').answer).toBe('Not sure');
  });
});
