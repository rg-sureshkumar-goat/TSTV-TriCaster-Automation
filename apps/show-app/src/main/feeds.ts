// The app's side of the TC1's feeds (Phase 5): starts feeds-worker.ts in the background, says where the
// page can watch each feed, and starts and stops recording the program feed to the laptop.
import { EventEmitter } from 'node:events';
import { Worker } from 'node:worker_threads';
import type { FeedsMessage, FeedsReport } from './feeds-worker.ts';

export class Feeds extends EventEmitter {
  private worker: Worker;
  private port: number | null = null;
  recording: { file: string | null; seconds: number; error: string | null } = { file: null, seconds: 0, error: null };
  error: string | null = null;

  constructor() {
    super();
    this.worker = new Worker(new URL('./worker-boot.mjs', import.meta.url), { workerData: { module: new URL('./feeds-worker.ts', import.meta.url).href } });
    this.worker.on('message', (report: FeedsReport) => {
      if (report.type === 'ready') this.port = report.port;
      else if (report.type === 'recording') this.recording = { file: report.file, seconds: report.seconds, error: report.error };
      else this.error = report.message;
      this.emit('change');
    });
    this.worker.on('error', (e: Error) => {
      this.error = e.message;
      this.emit('change');
    });
  }

  /** Where the page watches a feed: "1" to "4" (the TC1's inputs) or "program"; null until it's ready. */
  url(feed: string): string | null {
    return this.port ? `http://127.0.0.1:${this.port}/feed/${feed}` : null;
  }

  private send(message: FeedsMessage): void {
    this.worker.postMessage(message);
  }

  record(file: string): void {
    this.send({ type: 'record', file });
  }

  stopRecording(): void {
    this.send({ type: 'stopRecording' });
  }

  async close(): Promise<void> {
    this.send({ type: 'close' });
    await new Promise((r) => setTimeout(r, 300));
    await this.worker.terminate();
  }
}
