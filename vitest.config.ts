import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tools/**/test/**/*.test.{ts,mjs}', 'packages/**/test/**/*.test.ts', 'apps/**/test/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
