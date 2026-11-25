// SPDX-License-Identifier: AGPL-3.0-only
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '../..');

let envLoaded = false;
function ensureEnv(): void {
  if (envLoaded) return;
  envLoaded = true;
  // Root .env.local has the migration DB URL.
  process.loadEnvFile(path.join(ROOT, '.env.local'));
}

// Resets Postgres to the fixture baseline.
export function resetPostgres(): void {
  ensureEnv();
  execFileSync('pnpm', ['exec', 'tsx', 'scripts/db/seed-postgres-from-fixtures.ts', '--', '--reset'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
}
