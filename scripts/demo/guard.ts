// SPDX-License-Identifier: AGPL-3.0-only
// Refuses any database that is not a local demo one. OPENDISPATCH_DEMO_DB_HOSTS (comma separated)
// adds hosts that count as local, for example the database service name inside docker compose.
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

function allowedHosts(): Set<string> {
  const extra = (process.env['OPENDISPATCH_DEMO_DB_HOSTS'] ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter((h) => h !== '');
  return new Set([...LOCAL_HOSTS, ...extra]);
}

export function assertDemoDatabase(url: string): void {
  const parsed = new URL(url);
  const db = decodeURIComponent(parsed.pathname.slice(1));
  if (!db.includes('demo')) throw new Error(`Refusing: database "${db}" is not a demo database (name must contain "demo").`);
  if (!allowedHosts().has(parsed.hostname)) {
    throw new Error(`Refusing: host "${parsed.hostname}" is not local (127.0.0.1, localhost or OPENDISPATCH_DEMO_DB_HOSTS).`);
  }
}
