// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from '@playwright/test';
import { loadRootEnv } from './scripts/e2e-stack';
import { SECRET_ENV, readState, tenantsJson } from './scripts/keycloak/state.mjs';

loadRootEnv();

// docs/deploy/KEYCLOAK_DEV.md, end-to-end tests
const EXTERNAL = process.env['OPENDISPATCH_KC_E2E_WEB'];
const WEB = 3233;
const API = 8293;
const GO = path.join(import.meta.dirname, 'apps/api-go');
const STATE = path.resolve(process.env['OPENDISPATCH_KC_STATE_DIR'] ?? path.join(import.meta.dirname, '.demo-state/keycloak'));
const kc = readState(STATE);
if (kc === null) throw new Error(`No Keycloak state in ${STATE}: run pnpm keycloak:dev up --redirect http://localhost:${String(WEB)}`);
const OUT = path.join(import.meta.dirname, 'e2e-output/keycloak');
fs.mkdirSync(OUT, { recursive: true });
const TENANTS = path.join(OUT, 'tenants.json');
const tenantId = (JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures/manifest.json'), 'utf8')) as { tenant_id: string }).tenant_id;
fs.writeFileSync(TENANTS, JSON.stringify(tenantsJson(kc, `http://localhost:${String(WEB)}`, tenantId), null, 2));
process.env['OPENDISPATCH_KC_STATE_DIR'] = STATE;
process.env['OPENDISPATCH_KC_ISSUER'] = kc.issuer;
const bin = path.join(process.env['TMPDIR'] ?? '/tmp', `opendispatch-kc-e2e-${String(process.pid)}`);
// made up per run; the store is not used here
const storage = { OPENDISPATCH_S3_ACCESS_KEY: `e2e-${randomBytes(6).toString('hex')}`, OPENDISPATCH_S3_SECRET_KEY: randomBytes(16).toString('hex') };

export default defineConfig({
  testDir: 'e2e/keycloak',
  outputDir: 'e2e-output/keycloak/results',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'e2e-output/timings-keycloak.json' }]],
  timeout: 90_000,
  use: { baseURL: EXTERNAL ?? `http://localhost:${String(WEB)}`, viewport: { width: 1440, height: 900 } },
  webServer: EXTERNAL !== undefined ? [] : [
    {
      command: `go build -o ${bin}-api ./cmd/api && exec ${bin}-api`,
      cwd: GO,
      url: `http://127.0.0.1:${String(API)}/health`,
      env: {
        ...storage,
        [SECRET_ENV]: kc[SECRET_ENV] ?? '',
        OPENDISPATCH_AUTH_SECRET: randomBytes(32).toString('hex'),
        OPENDISPATCH_AUTH_MODE: 'oidc',
        OPENDISPATCH_OIDC_TENANTS_FILE: TENANTS,
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
