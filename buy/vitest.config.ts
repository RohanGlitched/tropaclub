import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Live tests hit public RPCs and the KyberSwap API; keep them serial to stay under rate limits.
    fileParallelism: false,
  },
});
