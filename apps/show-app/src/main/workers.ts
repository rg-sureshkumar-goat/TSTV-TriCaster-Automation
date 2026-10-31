// Starts a background worker (the playout or the feeds). Run from the source, through the terminal, each
// worker is TypeScript started by worker-boot.mjs; in the installed app (Phase 6) it's a bundled file.
import { Worker } from 'node:worker_threads';

export function startWorker(name: 'playout-worker' | 'feeds-worker', data: Record<string, unknown> = {}): Worker {
  if (import.meta.url.endsWith('.ts')) {
    return new Worker(new URL('./worker-boot.mjs', import.meta.url), { workerData: { ...data, module: new URL(`./${name}.ts`, import.meta.url).href } });
  }
  return new Worker(new URL(`./${name}.mjs`, import.meta.url), { workerData: data });
}
