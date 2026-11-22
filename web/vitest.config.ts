import path from 'node:path';
import { defineConfig } from 'vitest/config';

// The same path aliases as tsconfig.json, so tests can load server modules (with their I/O mocked).
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: path.join(here, '$1') },
      { find: /^@shared\/(.*)$/, replacement: path.join(here, '../shared/$1') },
      { find: /^@tropaclub\/buy$/, replacement: path.join(here, '../buy/src/index.ts') },
      { find: /^@tropaclub\/clubs$/, replacement: path.join(here, '../clubs/src/index.ts') },
    ],
  },
  test: { include: ['test/**/*.test.ts'] },
});
