// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { buildContext, fixtureTenantId, fixtureUsers } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { listVehicles } from '@/lib/data/people';
import { getDemoToday } from '@/lib/data/settings';
import { createVehicleMaintenance, deleteVehicleMaintenance } from '@/lib/data/vehicle-maintenance';
import { loadAgentsView } from './view';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
vi.setConfig({ testTimeout: 180_000 });

function admin(): RequestContext {
  const built = buildContext({ role: 'administrator', installMode: 'private', zoneIds: [] }, fixtureUsers(), fixtureTenantId());
  if (built === null) throw new Error('no administrator context');
  return built;
}

describe.skipIf(!hasApi)('vehicle maintenance on the Vehicles tab (live)', () => {
  it('gives each vehicle its windows, the one open on the demo day active', async () => {
    const ctx = admin();
    const today = await getDemoToday(ctx);
    const vehicle = (await listVehicles(ctx, { limit: 1 })).items[0]!;
    const open = await createVehicleMaintenance(ctx, { vehicle_id: vehicle.id, starts_at: `${today}T06:00:00+03:00`, ends_at: `${today}T18:00:00+03:00`, reason: 'Brake service' });
    const later = await createVehicleMaintenance(ctx, { vehicle_id: vehicle.id, starts_at: '2030-01-01T08:00:00+03:00', ends_at: '2030-01-01T10:00:00+03:00', reason: 'Oil change' });
    try {
      const view = await loadAgentsView(ctx, { vehicle: vehicle.id }, true, false);
      const items = view.maintenance[vehicle.id] ?? [];
      expect(items.map((w) => [w.reason, w.active])).toEqual([
        ['Brake service', true],
        ['Oil change', false],
      ]);
      expect(view.openVehicle?.id).toBe(vehicle.id);
    } finally {
      await deleteVehicleMaintenance(ctx, open.id);
      await deleteVehicleMaintenance(ctx, later.id);
    }
  });
});
