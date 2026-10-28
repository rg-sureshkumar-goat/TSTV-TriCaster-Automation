import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  // The browser tests keep their own local database (TSTV_STATE_DIR) so they never touch yours.
  plugins: [react(), cloudflare({ persistState: process.env.TSTV_STATE_DIR ? { path: process.env.TSTV_STATE_DIR } : true })],
});
