// SPDX-License-Identifier: AGPL-3.0-only
// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.

import { describe, expect, it } from 'vitest';
import { listAuditEvents } from './audit';
import { ConflictError, ForbiddenError, InvalidInputError } from './errors';
import { listVehicles } from './people';
import { createVehicleMaintenance, deleteVehicleMaintenance, listVehicleMaintenance } from './vehicle-maintenance';
import { ctxFor, expectValid } from './test-support';

const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';

describe.skipIf(!hasApi)('vehicle maintenance (live, real api and Postgres)', () => {
  const admin = () => ctxFor('administrator');

  it('adds, lists, refuses an overlap, removes, and audits each write', async () => {
    const ctx = admin();
    const vehicle = (await listVehicles(ctx, { limit: 1 })).items[0]!;
    const created = await createVehicleMaintenance(ctx, { vehicle_id: vehicle.id, starts_at: '2027-03-01T08:00:00+03:00', ends_at: '2027-03-02T08:00:00+03:00', reason: 'Brake service' });
    expectValid('VehicleMaintenance', created);
    try {
      const listed = await listVehicleMaintenance(ctx, { vehicle_id: vehicle.id, limit: 200 });
      expectValid('VehicleMaintenanceList', listed);
      expect(listed.items.map((w) => w.id)).toContain(created.id);
      expect((await listVehicleMaintenance(ctx, { active_on: '2027-03-02', limit: 200 })).items.map((w) => w.id)).toContain(created.id);
      expect((await listVehicleMaintenance(ctx, { active_on: '2027-03-03', limit: 200 })).items.map((w) => w.id)).not.toContain(created.id);
      await expect(createVehicleMaintenance(ctx, { vehicle_id: vehicle.id, starts_at: '2027-03-01T20:00:00+03:00', ends_at: '2027-03-01T22:00:00+03:00', reason: 'Tyres' })).rejects.toBeInstanceOf(ConflictError);
      await expect(createVehicleMaintenance(ctx, { vehicle_id: vehicle.id, starts_at: '2027-03-05T08:00:00+03:00', ends_at: '2027-03-05T07:00:00+03:00', reason: 'Tyres' })).rejects.toBeInstanceOf(InvalidInputError);
    } finally {
      await deleteVehicleMaintenance(ctx, created.id);
    }
    expect((await listVehicleMaintenance(ctx, { vehicle_id: vehicle.id, limit: 200 })).items.map((w) => w.id)).not.toContain(created.id);
    const actions = (await listAuditEvents(ctx, { limit: 50 })).items.map((e) => e.action);
    expect(actions).toContain('vehicle.maintenance_added');
    expect(actions).toContain('vehicle.maintenance_removed');
  });

  it('is the Administrator\'s: a planner may neither read nor write it', async () => {
    const planner = ctxFor('planner');
    await expect(listVehicleMaintenance(planner)).rejects.toBeInstanceOf(ForbiddenError);
    const vehicle = (await listVehicles(admin(), { limit: 1 })).items[0]!;
    await expect(createVehicleMaintenance(planner, { vehicle_id: vehicle.id, starts_at: '2027-04-01T08:00:00+03:00', ends_at: '2027-04-01T09:00:00+03:00', reason: 'x' })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
