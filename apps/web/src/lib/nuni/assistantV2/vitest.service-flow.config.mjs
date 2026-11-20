import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import base from '../../../../vitest.config.ts';

// Separate opt-in Node/JSDOM integration suite. Do not inherit setupFiles: it eagerly imports ReactDOM.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
export default defineConfig({
  root,
  resolve: base.resolve,
  test: {
    environment: 'node',
    globals: true,
    setupFiles: [],
    include: ['src/lib/nuni/assistantV2/assistantRevisionServiceFlow.integration.mjs'],
    maxWorkers: 1,
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
