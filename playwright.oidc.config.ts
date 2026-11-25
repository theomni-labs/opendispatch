// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { defineConfig } from '@playwright/test';
import { loadRootEnv } from './scripts/e2e-stack';

loadRootEnv();

// A real sign-in through the mock identity provider: mock IdP (8291), api in oidc mode (8292), web (3223).
// The database must already hold the fixtures (pnpm seed:postgres); the run changes nothing but sessions and the audit log.
const WEB = 3223;
const API = 8292;
const IDP = 8291;
const GO = path.join(import.meta.dirname, 'apps/api-go');
const bin = path.join(process.env['TMPDIR'] ?? '/tmp', `opendispatch-oidc-e2e-${String(process.pid)}`);
const secrets = { MOCKIDP_CLIENT_SECRET: 'e2e-secret', OPENDISPATCH_AUTH_SECRET: 'e2e-auth-secret-e2e-auth-secret-0123456789' };
// oidc mode refuses the dev storage keys; these are made up for the run and the store is not used by the test.
const storage = { OPENDISPATCH_S3_ACCESS_KEY: `e2e-${randomBytes(6).toString('hex')}`, OPENDISPATCH_S3_SECRET_KEY: randomBytes(16).toString('hex') };

export default defineConfig({
  testDir: 'e2e/oidc',
  globalSetup: './e2e/oidc/global-setup.ts',
  outputDir: 'e2e-output/oidc',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'e2e-output/timings-oidc.json' }]],
  timeout: 60_000,
  use: { baseURL: `http://localhost:${String(WEB)}`, viewport: { width: 1440, height: 900 } },
  webServer: [
    {
      command: `go build -o ${bin}-idp ./cmd/mockidp && exec ${bin}-idp`,
      cwd: GO,
      url: `http://127.0.0.1:${String(IDP)}/.well-known/openid-configuration`,
      env: { MOCKIDP_ADDR: `127.0.0.1:${String(IDP)}`, ...secrets },
      timeout: 120_000,
    },
    {
      command: `go build -o ${bin}-api ./cmd/api && exec ${bin}-api`,
      cwd: GO,
      url: `http://127.0.0.1:${String(API)}/health`,
      env: {
        ...secrets,
        ...storage,
        OPENDISPATCH_AUTH_MODE: 'oidc',
        OPENDISPATCH_OIDC_TENANTS_FILE: path.join(import.meta.dirname, 'e2e/oidc/tenants.json'),
        OPENDISPATCH_LISTEN_ADDR: `127.0.0.1:${String(API)}`,
        OPENDISPATCH_OWNER_DATABASE_URL: process.env['OPENDISPATCH_MIGRATION_DATABASE_URL'] ?? '',
        OPENDISPATCH_APP_DATABASE_URL: process.env['OPENDISPATCH_DATABASE_URL'] ?? '',
        OPENDISPATCH_MIGRATIONS_DIR: path.join(GO, 'migrations'),
      },
      timeout: 120_000,
    },
    {
      command: `pnpm --filter @opendispatch/web exec next start -p ${String(WEB)}`,
      url: `http://localhost:${String(WEB)}/en/sign-in`,
      env: { NEXT_TELEMETRY_DISABLED: '1', OPENDISPATCH_AUTH_MODE: 'oidc', OPENDISPATCH_API_URL: `http://127.0.0.1:${String(API)}`, OPENDISPATCH_BASIC_AUTH_USER: '', OPENDISPATCH_BASIC_AUTH_PASSWORD: '' },
      timeout: 120_000,
    },
  ],
});
