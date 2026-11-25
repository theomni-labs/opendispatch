// SPDX-License-Identifier: AGPL-3.0-only
// Demo-only: vehicles, fresh positions, open cases.
//
//   OPENDISPATCH_DEMO=1 pnpm exec tsx scripts/demo/seed-demo.ts
//
// Run after the normal seed and the feeds simulator.
// Idempotent. Refuses a non-demo name or a non-local host.
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { assertDemoDatabase } from './guard';

const ROOT = path.join(import.meta.dirname, '../..');
const OPEN_CASES = 20;

interface Row {
  readonly id: string;
  readonly home_zone_id: string | null;
  readonly default_vehicle_id: string | null;
}

async function main(): Promise<void> {
  if (process.env['OPENDISPATCH_DEMO'] !== '1') throw new Error('Refusing: set OPENDISPATCH_DEMO=1 to run the demo seed.');
  const url = process.env['OPENDISPATCH_MIGRATION_DATABASE_URL'];
  if (url === undefined || url === '') throw new Error('OPENDISPATCH_MIGRATION_DATABASE_URL is not set.');
  assertDemoDatabase(url);
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/manifest.json'), 'utf8')) as { tenant_id: string };
  const tenant = manifest.tenant_id;

  const sql = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await sql.begin(async (tx) => {
      const onDuty = await tx<Row[]>`
        SELECT s.id::text, s.home_zone_id::text, s.default_vehicle_id::text
        FROM agents s JOIN agent_live_state l ON l.tenant_id = s.tenant_id AND l.agent_id = s.id
        WHERE s.tenant_id = ${tenant} AND s.kind = 'field' AND s.is_active AND l.status <> 'offline'
        ORDER BY s.code`;
      if (onDuty.length === 0) throw new Error('No on-duty field agents in agent_live_state: run the feeds simulator first.');
      const vehicles = await tx<{ id: string; zone_id: string | null }[]>`
        SELECT id::text, zone_id::text FROM vehicles WHERE tenant_id = ${tenant} AND is_active ORDER BY code`;
      const byZone = new Map<string, string[]>();
      for (const v of vehicles) byZone.set(v.zone_id ?? '', [...(byZone.get(v.zone_id ?? '') ?? []), v.id]);
      const used = new Map<string, number>();
      let given = 0;
      let shared = 0;
      let none = 0;
      for (const s of onDuty) {
        if (s.default_vehicle_id !== null) continue;
        const zone = s.home_zone_id ?? '';
        const pool = byZone.get(zone) ?? [];
        if (pool.length === 0) {
          none += 1;
          continue;
        }
        const n = used.get(zone) ?? 0;
        used.set(zone, n + 1);
        if (n >= pool.length) shared += 1;
        await tx`UPDATE agents SET default_vehicle_id = ${pool[n % pool.length] ?? null}::uuid, updated_at = now() WHERE tenant_id = ${tenant} AND id = ${s.id}::uuid`;
        given += 1;
      }
      const fresh = await tx`
        UPDATE agent_live_state SET occurred_at = now(), updated_at = now()
        WHERE tenant_id = ${tenant} AND latitude IS NOT NULL AND longitude IS NOT NULL`;
      const open = await tx`
        WITH latest AS (
          SELECT id, row_number() OVER (ORDER BY registered_at DESC, id) AS n FROM cases
          WHERE tenant_id = ${tenant} AND handling = 'field' AND latitude IS NOT NULL AND longitude IS NOT NULL AND zone_id IS NOT NULL
          ORDER BY registered_at DESC, id LIMIT ${OPEN_CASES}
        )
        UPDATE cases c SET registered_at = now() - (latest.n - 1) * interval '45 seconds', assigned_at = NULL, arrived_at = NULL,
          closed_at = NULL, on_scene_completed_at = NULL, agent_id = NULL, vehicle_id = NULL, updated_at = now()
        FROM latest WHERE c.tenant_id = ${tenant} AND c.id = latest.id`;
      console.log(
        `Demo seed: ${String(onDuty.length)} on-duty field agents, ${String(given)} given a vehicle (${String(shared)} share one, ${String(none)} had none in their zone), ${String(fresh.count)} positions set to now, ${String(open.count)} recent cases left unassigned.`,
      );
    });
  } finally {
    await sql.end();
  }
}

await main();
