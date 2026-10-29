// Starts the show app. Electron runs this file; tsx lets it run the app's TypeScript as it is.
// (Phase 6 bundles the app into installers instead.)
import { register } from 'tsx/esm/api';

register();
await import('./src/main/main.ts');
