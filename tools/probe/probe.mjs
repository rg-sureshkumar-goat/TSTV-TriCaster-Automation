#!/usr/bin/env node
// @ts-check
// TSTV TriCaster probe. Run it on a laptop cabled to the TC1:  npm run probe
// It finds the TC1, records which remote-control interfaces it offers and what state it reports,
// and saves everything to tools/probe/results/. It only reads. It never sends a command.
import { parseArgs } from 'node:util';
import { runProbe } from './lib/run.mjs';
import { ask, askHidden } from './lib/ask.mjs';

const HELP = `
TSTV TriCaster probe (read-only)

Usage:  npm run probe [-- options]

Options:
  --host <address>      Skip the search and use this address (for example 169.254.10.20,
                        or 127.0.0.1:8080 to try the probe against the simulator)
  --http-port <n>       TriCaster web port (default 80)
  --state-port <n>      TriCaster state-stream port (default 5951)
  --listen <seconds>    How long to listen when not doing the guided steps (default 60)
  --no-guided           Skip the guided panel steps and just listen
  --wait <seconds>      How long to wait for the TC1 to appear on the cable (default 90)
  --out <folder>        Where to save results (default tools/probe/results)
  --yes                 Ask no questions (for automated runs)
  --help                Show this help
`;

const { values } = parseArgs({
  options: {
    host: { type: 'string' },
    'http-port': { type: 'string' },
    'state-port': { type: 'string' },
    listen: { type: 'string' },
    guided: { type: 'boolean', default: true },
    'no-guided': { type: 'boolean', default: false },
    wait: { type: 'string' },
    out: { type: 'string' },
    yes: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  allowPositionals: false,
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

let host = values.host;
let httpPort = values['http-port'] ? Number(values['http-port']) : undefined;
const hostWithPort = host?.match(/^([\d.]+|localhost):(\d+)$/);
if (hostWithPort) {
  host = hostWithPort[1];
  httpPort ??= Number(hostWithPort[2]);
}

const controller = new AbortController();
let interrupts = 0;
process.on('SIGINT', () => {
  interrupts++;
  if (interrupts > 1) process.exit(130);
  console.log('\nStopping. Saving what was found so far... (press Ctrl+C again to quit without saving)');
  controller.abort();
});

const interactive = Boolean(process.stdin.isTTY) && !values.yes;

console.log(`
TSTV TriCaster probe
--------------------
This only READS from the TC1. It never sends commands or changes settings.
It takes about 3 to 5 minutes. Press Ctrl+C at any time to stop; what was found so far is saved.
`);

try {
  const { files } = await runProbe({
    host,
    httpPort,
    statePort: values['state-port'] ? Number(values['state-port']) : undefined,
    listenSeconds: values.listen ? Number(values.listen) : undefined,
    guided: values.guided && !values['no-guided'],
    waitSeconds: values.wait ? Number(values.wait) : undefined,
    outDir: values.out,
    interactive,
    ask,
    askHidden,
    signal: controller.signal,
  });
  console.log(`\nDone. Results: ${files.json}`);
  process.exit(0);
} catch (err) {
  console.error('\nThe probe hit an unexpected problem:', err);
  console.error('Please send this message to Claude Code.');
  process.exit(1);
}
