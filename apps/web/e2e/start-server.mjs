// Starts a fresh copy of the website for the browser tests, with its own empty database.
// Works on Mac and Windows.
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = path.join(webDir, '.wrangler', 'e2e-state');
const windows = process.platform === 'win32';

rmSync(stateDir, { recursive: true, force: true });
// Pretend sign-in is needed for the tests; .dev.vars isn't committed, so make one from the example.
if (!existsSync(path.join(webDir, '.dev.vars'))) copyFileSync(path.join(webDir, '.dev.vars.example'), path.join(webDir, '.dev.vars'));

const migrate = spawnSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir], {
  cwd: webDir,
  stdio: 'inherit',
  shell: windows,
});
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const vite = spawn('npx', ['vite', '--port', '5174', '--strictPort'], {
  cwd: webDir,
  stdio: 'inherit',
  shell: windows,
  env: { ...process.env, TSTV_STATE_DIR: stateDir },
});
vite.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => vite.kill(signal));
