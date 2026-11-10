// Converts one graphic to the right format in a background worker (RG, Nov 10, 2026; see graphic-format.ts),
// so clearing the black around it, frame by frame, never holds up the rest of RiGster during a show.
import { parentPort, workerData } from 'node:worker_threads';
import { convertGraphic, type FormatProblem } from './graphic-format.ts';

const { file, folder, problems } = workerData as { file: string; folder: string; problems: FormatProblem[] };
try {
  parentPort?.postMessage({ path: await convertGraphic(file, folder, problems) });
} catch (e) {
  parentPort?.postMessage({ error: e instanceof Error ? e.message : String(e) });
}
