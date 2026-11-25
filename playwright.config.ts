// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from '@playwright/test';
import { ensureEmergencyAdminCreds } from './e2e/emergency-admin';
import { e2eWorkers } from './scripts/e2e-stack';

// E2E_PORT: run beside another checkout's suite.
const PORT = Number(process.env['E2E_PORT'] ?? '3123');

// Env wins over .env.local for the server.
const { password: emergencyPassword, code: emergencyCode } = ensureEmergencyAdminCreds();

// Definition of Done: screenshots of every changed screen in English and Arabic at 1440px and 390px.
// Build first (`pnpm build`), then `pnpm e2e:shots`. The specs sign in through the demo start page, so the app needs
// DEMO_SESSION_SECRET (apps/web/.env.local). The server is started fresh from the build; set E2E_REUSE_SERVER=1 to reuse
// one already running on the port (a stale one would test an old build).
export default defineConfig({
  testDir: 'e2e',
  testIgnore: ['**/oidc/**'],
  outputDir: 'e2e-output/results',
  fullyParallel: false,
  globalSetup: './e2e/global-setup.ts',
  // E2E_WORKERS>1: each worker has its own Go server and database.
  workers: e2eWorkers(),
  reporter: [['list'], ['json', { outputFile: 'e2e-output/timings-shots.json' }]],
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    // Desktop runs everything. The phone
    // runs the screenshots and the drawer test: the role, menu and access specs read the rail, which is a drawer at 390px
    // (phone.spec.ts covers that).
    { name: 'desktop', testIgnore: ['**/phone.spec.ts', '**/oidc/**'], use: { viewport: { width: 1440, height: 900 } } },
    { name: 'phone', testMatch: ['**/screenshots.spec.ts', '**/phone.spec.ts'], use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: `pnpm --filter @opendispatch/web exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}/en`,
    reuseExistingServer: process.env['E2E_REUSE_SERVER'] === '1',
    timeout: 120_000,
    // Empty on purpose: overrides the Basic Auth gate.
    env: {
      NEXT_TELEMETRY_DISABLED: '1',
      DEMO_EMERGENCY_ADMIN_PASSWORD: emergencyPassword,
      DEMO_EMERGENCY_ADMIN_TOTP: emergencyCode,
      OPENDISPATCH_BASIC_AUTH_USER: '',
      OPENDISPATCH_BASIC_AUTH_PASSWORD: '',
    },
  },
});
