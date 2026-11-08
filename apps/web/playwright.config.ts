import { defineConfig, devices } from '@playwright/test';

// Browser tests: real browsers, two people at once, against a local copy of the website.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5174',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    // The prompter computer is a Mac running Safari, so on a Mac the prompter is also tested in Safari's engine.
    // Not on Windows: Safari doesn't run there, and Windows' copy of its engine draws frames too slowly to scroll.
    ...(process.platform === 'win32'
      ? []
      : [{ name: 'safari', testMatch: /prompter\.spec\.ts/, use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } }]),
  ],
  webServer: {
    command: 'node e2e/start-server.mjs',
    url: 'http://localhost:5174/api/auth/options',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
