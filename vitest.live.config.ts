import { defineConfig } from 'vitest/config';

// The opt-in sandbox suite (`npm run test:live`). One worker without isolation, so the files
// run in order against one client: one login, one gate check, no parallel load on the sandbox.
export default defineConfig({
  test: {
    include: ['tests/live/**/*.test.ts'],
    environment: 'node',
    clearMocks: true,
    allowOnly: false,
    fileParallelism: false,
    isolate: false,
    maxWorkers: 1,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
