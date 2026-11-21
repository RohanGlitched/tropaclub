import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // The Firestore-backed suites share one emulator database; keep files serial.
    fileParallelism: false,
  },
});
