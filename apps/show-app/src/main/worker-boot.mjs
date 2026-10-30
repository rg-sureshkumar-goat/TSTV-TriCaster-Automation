// Starts a background worker that runs the app's TypeScript, the same way main.mjs starts the app.
import { workerData } from 'node:worker_threads';
import { register } from 'tsx/esm/api';

register();
await import(workerData.module);
