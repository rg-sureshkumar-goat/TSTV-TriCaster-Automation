// Converts one graphic to the right format in a background worker (RG, Nov 10, 2026; see graphic-format.ts),
// so clearing the black around it, frame by frame, never holds up the rest of RiGster during a show.
import { parentPort, workerData } from 'node:worker_threads';
import { stopBackground } from './ffmpeg.ts';
import { convertGraphic, type FormatProblem } from './graphic-format.ts';

const { file, folder, problems } = workerData as { file: string; folder: string; problems: FormatProblem[] };
// RiGster is closing: FFmpeg stops, so the file it was reading isn't left open.
parentPort?.on('message', (m) => {
  if (m !== 'stop') return;
  stopBackground();
  process.exit(0);
});
// The listener doesn't keep the worker open once its conversion is done.
parentPort?.unref();
try {
  parentPort?.postMessage({ path: await convertGraphic(file, folder, problems) });
} catch (e) {
  parentPort?.postMessage({ error: e instanceof Error ? e.message : String(e) });
}
