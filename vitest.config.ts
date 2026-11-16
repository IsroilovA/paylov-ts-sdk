import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/live/**'],
    environment: 'node',
    clearMocks: true,
    allowOnly: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      reportsDirectory: 'coverage',
      reporter: ['text', 'json-summary', 'html'],
      thresholds: {
        statements: 98,
        lines: 98,
        branches: 95,
        functions: 99,
        perFile: { statements: 90, lines: 90, branches: 83, functions: 90 },
        'src/core/money.ts': { 100: true, perFile: true },
        'src/core/time.ts': { 100: true, perFile: true },
      },
    },
  },
});
