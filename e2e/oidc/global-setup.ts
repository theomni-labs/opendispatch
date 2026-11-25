// SPDX-License-Identifier: AGPL-3.0-only
import postgres from 'postgres';
import { loadRootEnv } from '../../scripts/e2e-stack';

// An active person with no identity-provider subject cannot be linked by email (only an invited one can), so the two people the
// mock provider signs in are linked by subject first, as an administrator would have done.
export default async function globalSetup(): Promise<void> {
  loadRootEnv();
  const url = process.env['OPENDISPATCH_MIGRATION_DATABASE_URL'];
  if (url === undefined || url === '') throw new Error('OPENDISPATCH_MIGRATION_DATABASE_URL is not set.');
  const sql = postgres(url, { max: 1 });
  try {
    await sql`UPDATE users SET keycloak_subject = 'sub-nadia' WHERE email = 'nadia.al.ghalani@demo.example'`;
    await sql`UPDATE users SET keycloak_subject = 'sub-fahad' WHERE email = 'fahad.al.musari@demo.example'`;
  } finally {
    await sql.end();
  }
}
