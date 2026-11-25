// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from '@playwright/test';
import { ensureEmergencyAdminCreds } from './e2e/emergency-admin';
import { e2eWorkers } from './scripts/e2e-stack';

ensureEmergencyAdminCreds();

// No webServer: avoids port-3123 races.
export default defineConfig({
  testDir: 'e2e/flows',
  outputDir: 'e2e-output/results',
  // A file's tests share one server, so they stay in order.
  fullyParallel: false,
  globalSetup: './e2e/global-setup.ts',
  reporter: [['list'], ['json', { outputFile: 'e2e-output/timings-flows.json' }]],
  // 30s default too short for a Postgres reset.
  timeout: 150_000,
  // E2E_WORKERS>1: each worker has its own Go server and database.
  workers: e2eWorkers(),
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'phone', use: { viewport: { width: 390, height: 844 } } },
  ],
});
