// Starts the simulator from the command line:  npm run simulator
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { startSimulator } from './server.ts';

const { values } = parseArgs({
  options: {
    host: { type: 'string', default: '127.0.0.1' },
    'http-port': { type: 'string', default: '8080' },
    'state-port': { type: 'string', default: '5951' },
    'no-open': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

if (values.help) {
  console.log(`
TSTV TriCaster simulator: a fake TC1 for development and practice

Usage:  npm run simulator [-- options]

  --http-port <n>    Web API and simulator page port (default 8080)
  --state-port <n>   State-stream port, like the TC1's 5951 (default 5951)
  --host <address>   Address to listen on (default 127.0.0.1, this laptop only)
  --no-open          Don't open the simulator page in the browser
`);
  process.exit(0);
}

try {
  const sim = await startSimulator({
    host: values.host,
    httpPort: Number(values['http-port']),
    statePort: Number(values['state-port']),
  });
  const shown = sim.host === '0.0.0.0' ? '127.0.0.1' : sim.host;
  const page = `http://${shown}:${sim.httpPort}/sim/`;
  console.log(`
TSTV TriCaster simulator is running. This is NOT the real TC1.

  Simulator page:      ${page}
  Fake TC1 web API:    http://${shown}:${sim.httpPort}/v1/version
  Fake state stream:   ${shown}:${sim.statePort}

Try the probe against it in a second terminal:
  npm run probe -- --host ${shown}:${sim.httpPort} --state-port ${sim.statePort}

Press Ctrl+C to stop the simulator.
`);
  if (sim.host !== '127.0.0.1') console.log(`Note: listening on ${sim.host}, so other computers on this network can reach it.\n`);
  if (!values['no-open']) openBrowser(page);

  process.on('SIGINT', async () => {
    console.log('\nStopping the simulator...');
    await sim.close();
    process.exit(0);
  });
} catch (err) {
  const e = err as NodeJS.ErrnoException;
  if (e.code === 'EADDRINUSE') {
    console.error(`\nA port the simulator needs is already in use. Is the simulator already running in another window?`);
    console.error('Close it, or pick other ports, for example:  npm run simulator -- --http-port 8081 --state-port 5961\n');
  } else {
    console.error('\nThe simulator could not start:', e.message);
  }
  process.exit(1);
}

function openBrowser(url: string) {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url]]
        : ['xdg-open', [url]];
  const child = spawn(command, args as string[], { stdio: 'ignore', detached: true, windowsHide: true });
  child.on('error', () => console.log(`Open ${url} in your browser to see the simulator.`));
  child.unref();
}
