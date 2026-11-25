// SPDX-License-Identifier: AGPL-3.0-only
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { classifyTests, listTestFiles } from './tools/test-classify';
import { liveWorkers } from './scripts/vitest-live-workers';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const { pure, live } = classifyTests(ROOT, listTestFiles(ROOT));
const workers = liveWorkers();

// Component tests opt in to jsdom with a docblock.
// pure: parallel, no Go or Postgres. live: one file at a time on one server,
// or VITEST_LIVE_WORKERS servers, each with its own database.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)) },
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'node',
    reporters: ['default', ['json', { outputFile: 'e2e-output/timings-vitest.json' }]],
    testTimeout: 30_000, // the first ESLint run loads the whole Next config
    // next-intl imports 'next/navigation' by its bare name; Vitest cannot resolve it unless next-intl goes through Vite.
    server: { deps: { inline: [/next-intl/] } },
    projects: [
      { extends: true, test: { name: 'pure', include: pure, setupFiles: ['./tools/vitest-dom-setup.ts'], env: { OPENDISPATCH_API_URL: '' } } },
      {
        extends: true,
        test: {
          name: 'live',
          include: live,
          fileParallelism: workers > 1,
          setupFiles: ['./scripts/vitest-live-worker-env.ts', './tools/vitest-dom-setup.ts'],
          ...(workers > 1 ? { maxWorkers: workers } : {}),
          globalSetup: ['./scripts/vitest-live-workers.ts'],
        },
      },
    ],
  },
});
