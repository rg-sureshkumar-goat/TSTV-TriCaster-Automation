// @ts-check
// Runs the whole probe and saves the results. probe.mjs is the command-line wrapper around this.
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeAdapters, parseHardwarePorts, runCommand } from './network.mjs';
import { discover, explicitCandidate } from './discover.mjs';
import { checkPorts, TRICASTER_PORTS } from './ports.mjs';
import { buildAuthorization, readOnlyGet } from './http.mjs';
import { listenStatePort } from './statePort.mjs';
import { listenWebSocket } from './websocket.mjs';
import { buildAnswers, buildSummary } from './report.mjs';

export const PROBE_VERSION = '1.0.0';

/**
 * Data the probe asks for by name. Bitfocus Companion uses the first six; the rest are guesses that are
 * harmless to try. Names the TC1 announces in its change notifications are read too.
 */
export const DICTIONARY_KEYS = Object.freeze([
  'shortcut_states',
  'tally',
  'switcher',
  'macros_list',
  'switcher_ui_effects',
  'product_information',
  'datalink_values',
  'buffer',
  'ddr_playlist',
  'ddr1_playlist',
  'ddr2_playlist',
  'ddr_timecode',
  'record',
  'recording',
  'record_config',
  'audio_mixer',
  'session',
  'inputs',
  'outputs',
  'media',
]);

/** Panel actions RG does himself during the listening minute, so we learn which states each one moves. */
export const GUIDED_STEPS = Object.freeze([
  { id: 'baseline', text: 'Hands off for 10 seconds, so the probe can see what changes on its own (like clocks).', autoSeconds: 10 },
  { id: 'camera', text: 'Take a different camera to Program, then take the first one back.' },
  { id: 'dsk2', text: 'Turn DSK 2 on, wait a second, then turn it off.' },
  { id: 'ddr2_select', text: 'In DDR2, click a different item in the playlist (don\'t play it).' },
  { id: 'ddr2_play', text: 'Play that DDR2 item for a few seconds, then stop it.' },
  { id: 'ddr2_end', text: 'If DDR2 has a short clip (under 20 seconds), play it and let it reach the end by itself. Otherwise skip.' },
  { id: 'gfx1', text: 'In GFX 1, select a different still, then select the original again.' },
  { id: 'me2', text: 'Take M/E 2 (the green-screen M/E) to Program, then take the camera back.' },
  { id: 'record', text: 'Optional: start recording, wait 5 seconds, then stop. Skip if you\'d rather not make a file.' },
]);

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_OUT_DIR = path.resolve(HERE, '..', 'results');

/**
 * @typedef {{
 *   host?: string,
 *   httpPort?: number,
 *   statePort?: number,
 *   listenSeconds?: number,
 *   guided?: boolean,
 *   interactive?: boolean,
 *   sweep?: boolean,
 *   outDir?: string,
 *   waitForCableMs?: number,
 *   log?: (line: string) => void,
 *   ask?: (question: string, signal?: AbortSignal) => Promise<string>,
 *   askHidden?: (question: string) => Promise<string>,
 *   signal?: AbortSignal,
 * }} ProbeOptions
 */

/**
 * @param {ProbeOptions} options
 */
export async function runProbe(options = {}) {
  const {
    httpPort = 80,
    statePort = 5951,
    listenSeconds = 60,
    guided = true,
    interactive = false,
    sweep = true,
    outDir = DEFAULT_OUT_DIR,
    waitForCableMs = 75_000,
    log = console.log,
    ask = async () => '',
    askHidden = async () => '',
    signal,
  } = options;
  const host = options.host;
  const startedAt = new Date();
  /** @type {string[]} */
  const errors = [];
  const stopped = () => Boolean(signal?.aborted);

  /** @type {any} */
  const results = {
    probe: { name: 'TSTV TriCaster probe', version: PROBE_VERSION, readOnly: true, startedAt: startedAt.toISOString() },
    options: { host: host ?? null, httpPort, statePort, listenSeconds, guided: guided && interactive, sweep },
    laptop: {},
    discovery: {},
    ports: {},
    http: { requests: {}, dictionary: {}, notificationReads: {} },
    stateStream: {},
    notifications: {},
    guidedSteps: [],
    fileSharing: {},
    errors,
  };

  // 1. The laptop and its adapters
  const platform = process.platform;
  const loopback = host !== undefined && /^(127\.|localhost$|::1$)/.test(host);
  const hardwarePortsCmd = platform === 'darwin' ? await runCommand('networksetup', ['-listallhardwareports']) : undefined;
  const hardwarePorts = hardwarePortsCmd ? parseHardwarePorts(hardwarePortsCmd.stdout) : {};
  let adapters = describeAdapters(os.networkInterfaces(), hardwarePorts);
  let wired = adapters.filter((a) => a.kind === 'wired');

  if (!loopback && !host) {
    if (wired.length === 0 && interactive) {
      for (let attempt = 0; attempt < 3 && wired.length === 0 && !stopped(); attempt++) {
        log('\nI don\'t see a cable connection on this laptop yet.');
        log('Plug the USB-C-to-Ethernet adapter into the laptop and the cable into the TC1\'s "Show laptop" port.');
        const reply = await ask('Press Enter to look again, or type q and Enter to stop: ', signal);
        if (reply.toLowerCase().startsWith('q')) break;
        adapters = describeAdapters(os.networkInterfaces(), hardwarePorts);
        wired = adapters.filter((a) => a.kind === 'wired');
      }
    }
    const deadline = Date.now() + waitForCableMs;
    if (wired.length > 0 && wired.every((a) => a.ipv4.length === 0)) {
      log('The cable is connected. Waiting for it to get an automatic address (this can take up to a minute)...');
      while (Date.now() < deadline && wired.every((a) => a.ipv4.length === 0) && !stopped()) {
        await sleep(3000);
        adapters = describeAdapters(os.networkInterfaces(), hardwarePorts);
        wired = adapters.filter((a) => a.kind === 'wired');
      }
    }
  }

  results.laptop = {
    platform,
    release: os.release(),
    arch: os.arch(),
    node: process.version,
    adapters,
    wiredAdapters: wired.map((a) => a.name),
    hardwarePorts: hardwarePortsCmd,
    commands: await laptopCommands(platform),
  };
  for (const adapter of wired) {
    log(`Cable adapter: ${adapter.name}${adapter.label ? ` (${adapter.label})` : ''}, address ${adapter.ipv4.map((a) => a.address).join(', ') || 'none yet'}`);
  }

  // 2. Find the TC1
  /** @type {import('./discover.mjs').Candidate | undefined} */
  let chosen;
  if (host) {
    chosen = explicitCandidate(host, wired);
    chosen.quickPorts = await checkPorts({ host, localAddress: chosen.localAddress }, [httpPort, statePort]);
    results.discovery = { chosen, note: 'Address typed in, so automatic discovery was skipped.' };
  } else if (wired.length > 0) {
    const found = await discover({ wired, platform, httpPort, statePort, sweep, log, signal });
    results.discovery = found;
    chosen = found.chosen;
  } else {
    results.discovery = { note: 'No cable adapter was found, so there was nothing to search.' };
  }

  if (!chosen || stopped()) {
    log(chosen ? 'Stopped.' : 'Could not find the TC1 on the cable.');
    return save(results, startedAt, outDir, log, stopped());
  }
  log(`\nFound a device at ${chosen.host} (${chosen.sources.join(', ')}). Reading what it offers...`);

  // 3. Ports
  const target = { host: chosen.host, localAddress: chosen.localAddress };
  results.ports = await checkPorts(target, TRICASTER_PORTS.map((p) => p.port));
  results.portNotes = Object.fromEntries(TRICASTER_PORTS.map((p) => [String(p.port), p.why]));

  // 4. Web reads, asking once for the LivePanel password if needed
  const web = { ...target, port: httpPort };
  /** @type {import('./http.mjs').Credentials | undefined} */
  let credentials;
  let version = await readOnlyGet(web, '/v1/version');
  if (version.status === 401) {
    results.http.authChallenge = version.headers['www-authenticate'] ?? '';
    log('The TC1 asks for its LivePanel password.');
    if (interactive) {
      const username = (await ask('Username (press Enter for "admin"): ', signal)) || 'admin';
      const password = await askHidden('Password (not shown, not saved; press Enter to skip): ');
      if (password) {
        credentials = { username, password };
        version = await readOnlyGet(web, '/v1/version', { credentials });
        results.http.authUsed = version.status === 200 ? version.authScheme ?? 'yes' : false;
        log(version.status === 200 ? 'Password accepted.' : 'That password did not work; continuing without it.');
        if (version.status !== 200) credentials = undefined;
      }
    }
  }
  results.http.requests['/v1/version'] = version;
  for (const p of ['/', '/v1/', '/v1/datalink']) results.http.requests[p] = await readOnlyGet(web, p, { credentials });
  for (const key of DICTIONARY_KEYS) {
    if (stopped()) break;
    results.http.dictionary[key] = await readOnlyGet(web, `/v1/dictionary?key=${key}`, { credentials });
  }
  const readable = Object.entries(results.http.dictionary).filter(([, r]) => /** @type {any} */ (r).status === 200).length;
  log(`Web API: /v1/version answered ${describeStatus(version)}; ${readable} of ${DICTIONARY_KEYS.length} data names readable.`);

  // 5. Listen to the state stream and change notifications
  const t0 = Date.now();
  /** @type {Map<string, { value: string, type?: string, firstMs: number, changes: number, lastChangedMs?: number }>} */
  const states = new Map();
  /** @type {{ t: number, name: string, value: string }[]} */
  const changes = [];
  /** @type {{ t: number, text: string }[]} */
  const notifications = [];
  /** @type {Map<string, number>} */
  const lastRead = new Map();
  let notificationReads = 0;

  const stateConn = listenStatePort(
    { host: chosen.host, port: statePort, localAddress: chosen.localAddress },
    {
      onBuild: (info) => (results.stateStream.build = info),
      onState: ({ name, value, type }) => {
        const t = Date.now() - t0;
        const prev = states.get(name);
        if (!prev) {
          states.set(name, { value, type, firstMs: t, changes: 0 });
        } else if (prev.value !== value) {
          prev.value = value;
          prev.changes++;
          prev.lastChangedMs = t;
          if (changes.length < 50_000) changes.push({ t, name, value });
        }
      },
      onClose: (reason) => (results.stateStream.closedBecause = reason),
    },
  );
  const stateOpen = await stateConn.opened;
  results.stateStream.connected = stateOpen.connected;
  if (stateOpen.error) results.stateStream.error = stateOpen.error;

  const basicAuth = credentials && results.http.authUsed === 'Basic' ? buildAuthorization('Basic', credentials, '/')?.header : undefined;
  const ws = listenWebSocket(web, '/v1/change_notifications', {
    authorization: basicAuth,
    onMessage: (text) => {
      notifications.push({ t: Date.now() - t0, text: text.slice(0, 2000) });
      const key = text.trim();
      if (!/^[A-Za-z0-9_]{1,64}$/.test(key) || notificationReads >= 300) return;
      if (Date.now() - (lastRead.get(key) ?? 0) < 3000) return;
      lastRead.set(key, Date.now());
      notificationReads++;
      readOnlyGet(web, `/v1/dictionary?key=${key}`, { credentials, maxBytes: 300_000 }).then((r) => {
        const prior = results.http.notificationReads[key];
        results.http.notificationReads[key] = { reads: (prior?.reads ?? 0) + 1, latest: r };
      });
    },
    onClose: (reason) => (results.notifications.closedBecause = reason),
  });
  const wsOpen = await ws.opened;
  Object.assign(results.notifications, wsOpen);
  log(`State stream: ${stateOpen.connected ? 'connected' : `not available (${stateOpen.error})`}. Change notifications: ${wsOpen.upgraded ? 'connected' : `not available (${wsOpen.error ?? `HTTP ${wsOpen.status}`})`}.`);

  await sleep(1500); // let the first full state list arrive
  if (guided && interactive && (stateOpen.connected || wsOpen.upgraded)) {
    log('\nNow a few panel steps, done by you on the TC1SP panel or the TC1 screen. The probe only watches.');
    log('Do these only when no show is running. Each one is something you\'d normally do on the panel.');
    /** @type {Set<string>} */
    let noise = new Set();
    for (const [i, step] of GUIDED_STEPS.entries()) {
      if (stopped()) break;
      const before = snapshot(states);
      const startMs = Date.now() - t0;
      log(`\nStep ${i + 1} of ${GUIDED_STEPS.length}: ${step.text}`);
      let skipped = false;
      if (step.autoSeconds) {
        await sleep(step.autoSeconds * 1000);
      } else {
        const reply = await ask('  Press Enter when done, or type s and Enter to skip: ', signal);
        skipped = reply.toLowerCase().startsWith('s');
      }
      await sleep(700); // catch the last updates
      const endMs = Date.now() - t0;
      const changed = diff(before, snapshot(states));
      if (step.id === 'baseline') noise = new Set(Object.keys(changed));
      const filtered = Object.fromEntries(Object.entries(changed).filter(([name]) => step.id === 'baseline' || !noise.has(name)));
      results.guidedSteps.push({
        id: step.id,
        text: step.text,
        skipped,
        startMs,
        endMs,
        changedStates: filtered,
        ignoredClockLikeStates: step.id === 'baseline' ? [] : Object.keys(changed).filter((n) => noise.has(n)),
        sequence: changes.filter((c) => c.t >= startMs && c.t <= endMs).slice(0, 400),
        notifications: notifications.filter((n) => n.t >= startMs && n.t <= endMs).map((n) => n.text),
      });
      if (!skipped) log(`  Saw ${Object.keys(filtered).length} state change(s).`);
    }
  } else {
    log(`\nListening for ${listenSeconds} seconds. If no show is running, you can press a few panel buttons now.`);
    const end = Date.now() + listenSeconds * 1000;
    while (Date.now() < end && !stopped()) await sleep(Math.min(1000, end - Date.now()));
  }

  stateConn.close();
  ws.close();
  await sleep(300);
  results.stateStream = {
    ...results.stateStream,
    stateCount: states.size,
    states: Object.fromEntries([...states.entries()].sort(([a], [b]) => a.localeCompare(b))),
    changes,
    raw: stateConn.raw(),
  };
  results.notifications.messages = notifications;

  // 6. File sharing
  if (results.ports['445'] === 'open' && !chosen.host.includes(':')) {
    results.fileSharing.shareList =
      platform === 'win32'
        ? await runCommand('net', ['view', `\\\\${chosen.host}`, '/all'], 10_000)
        : platform === 'darwin'
          ? await runCommand('smbutil', ['view', '-N', '-g', `//${chosen.host}`], 10_000)
          : undefined;
  }

  return save(results, startedAt, outDir, log, stopped());
}

/**
 * @param {any} results
 * @param {Date} startedAt
 * @param {string} outDir
 * @param {(line: string) => void} log
 * @param {boolean} stoppedEarly
 */
async function save(results, startedAt, outDir, log, stoppedEarly) {
  results.probe.finishedAt = new Date().toISOString();
  results.probe.seconds = Math.round((Date.now() - startedAt.getTime()) / 1000);
  results.probe.stoppedEarly = stoppedEarly;
  results.answers = buildAnswers(results);
  await fs.mkdir(outDir, { recursive: true });
  const stamp = timestamp(startedAt);
  const json = path.join(outDir, `tstv-probe-results-${stamp}.json`);
  const summaryPath = path.join(outDir, `tstv-probe-results-${stamp}-summary.txt`);
  const summary = buildSummary(results, { json, summary: summaryPath });
  await fs.writeFile(json, JSON.stringify(results, null, 2));
  await fs.writeFile(summaryPath, summary);
  log(`\n${summary}`);
  return { results, files: { json, summary: summaryPath } };
}

/** @param {string} platform */
async function laptopCommands(platform) {
  if (platform === 'darwin') return [await runCommand('netstat', ['-rn', '-f', 'inet']), await runCommand('ifconfig', [])];
  if (platform === 'win32') return [await runCommand('ipconfig', ['/all']), await runCommand('route', ['print', '-4'])];
  return [await runCommand('ip', ['addr']), await runCommand('ip', ['route'])];
}

/** @param {Map<string, { value: string }>} states */
function snapshot(states) {
  return new Map([...states.entries()].map(([name, s]) => [name, s.value]));
}

/**
 * @param {Map<string, string>} before
 * @param {Map<string, string>} after
 */
function diff(before, after) {
  /** @type {Record<string, { from: string | null, to: string }>} */
  const changed = {};
  for (const [name, value] of after) {
    const old = before.get(name);
    if (old !== value) changed[name] = { from: old ?? null, to: value };
  }
  return changed;
}

/** @param {import('./http.mjs').HttpResult} r */
function describeStatus(r) {
  return r.status ? `HTTP ${r.status}` : `no answer (${r.error})`;
}

/** @param {Date} d */
function timestamp(d) {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
