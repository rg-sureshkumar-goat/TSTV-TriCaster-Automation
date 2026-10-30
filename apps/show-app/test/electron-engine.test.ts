// Checks that run inside Electron's own engine, which forbids some things plain Node allows (koffi pointing
// straight at native memory stopped the whole app at the studio, Oct 30, 2026). The other tests run in Node.
import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const electron = require('electron') as unknown as string;
const koffiModule = pathToFileURL(require.resolve('koffi')).href;
const ndiModule = new URL('../src/main/ndi.ts', import.meta.url).href;

describe('in Electron’s engine', () => {
  it('copies NDI’s frames and sound out of native memory without stopping the app', async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'tstv-electron-'));
    const script = path.join(folder, 'copy.mts');
    await writeFile(
      script,
      `import koffi from '${koffiModule}';
import { copyBytes, copySound } from '${ndiModule}';
const ndi = { koffi } as never;
const memory = koffi.alloc('uint8_t', 32);
koffi.encode(memory, koffi.array('uint8_t', 4), [1, 2, 3, 4]);
const bytes = copyBytes(ndi, memory, 32);
// Two channels of two samples, with room for four each: 0.5, 0.25 | -0.5, -0.25.
const sound = koffi.alloc('float', 8);
koffi.encode(sound, koffi.array('float', 8), [0.5, 0.25, 9, 9, -0.5, -0.25, 9, 9]);
const interleaved = copySound(ndi, { p_data: sound, no_samples: 2, no_channels: 2, channel_stride_in_bytes: 16 });
console.log(JSON.stringify({ bytes: [...bytes.subarray(0, 4)], interleaved: [...interleaved] }));
`,
    );
    try {
      const { stdout } = await run(electron, ['--import', 'tsx', script], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, cwd: path.resolve(fileURLToDir(import.meta.url), '..'), timeout: 30_000 });
      expect(JSON.parse(stdout.trim().split('\n').pop()!)).toEqual({ bytes: [1, 2, 3, 4], interleaved: [0.5, -0.5, 0.25, -0.25] });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }, 40_000);
});

function fileURLToDir(url: string): string {
  return path.dirname(new URL(url).pathname.replace(/%20/g, ' '));
}
