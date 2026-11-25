// SPDX-License-Identifier: AGPL-3.0-only
// Resets the test Postgres before the suite: no drift.
// Skips, never fakes, if api-backed env is unconfigured.
import { execFileSync } from 'node:child_process';

export default function setup(): void {
  if (process.env['OPENDISPATCH_MIGRATION_DATABASE_URL'] === undefined) return;
  execFileSync('pnpm', ['exec', 'tsx', 'scripts/db/seed-postgres-from-fixtures.ts', '--reset'], {
    stdio: 'inherit',
    env: process.env,
  });
}
