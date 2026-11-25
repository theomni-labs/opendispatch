// SPDX-License-Identifier: AGPL-3.0-only
// Vehicle maintenance windows (spec 4.4): Go client.

import type { VehicleMaintenance, VehicleMaintenanceList } from '@/lib/types';
import type { PageQuery } from './context';
import type { RequestContext } from './guard';
import { businessFetch } from './internal/business-client';
import { pathSegment } from './internal/path-segment';

function qs(params: Readonly<Record<string, string | number | undefined>>): string {
  const parts = Object.entries(params).filter(([, val]) => val !== undefined && val !== '');
  return parts.length === 0 ? '' : `?${parts.map(([k, val]) => `${k}=${encodeURIComponent(String(val))}`).join('&')}`;
}

// operationId: listVehicleMaintenance
export async function listVehicleMaintenance(
  ctx: RequestContext,
  query: PageQuery & { readonly vehicle_id?: string | undefined; readonly active_on?: string | undefined } = {},
): Promise<VehicleMaintenanceList> {
  return (
    await businessFetch<VehicleMaintenanceList>(
      ctx,
      `/vehicle-maintenance${qs({ limit: query.limit, cursor: query.cursor, vehicle_id: query.vehicle_id, active_on: query.active_on })}`,
    )
  )!;
}

// operationId: createVehicleMaintenance
export async function createVehicleMaintenance(ctx: RequestContext, body: unknown): Promise<VehicleMaintenance> {
  return (await businessFetch<VehicleMaintenance>(ctx, '/vehicle-maintenance', { method: 'POST', body }))!;
}

// operationId: deleteVehicleMaintenance
export async function deleteVehicleMaintenance(ctx: RequestContext, id: string): Promise<void> {
  await businessFetch<undefined>(ctx, `/vehicle-maintenance/${pathSegment(id)}`, { method: 'DELETE' });
}
