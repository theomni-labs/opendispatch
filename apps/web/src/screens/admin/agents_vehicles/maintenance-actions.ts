'use server';
// SPDX-License-Identifier: AGPL-3.0-only

// Vehicle maintenance writes; the server-built context rule as actions.ts.

import { pickText } from '@/lib/actions/pick';
import { runAction } from '@/lib/actions/run-action';
import type { ActionResult } from '@/lib/actions/types';
import { InvalidInputError } from '@/lib/data/errors';
import { createVehicleMaintenance, deleteVehicleMaintenance } from '@/lib/data/vehicle-maintenance';
import { LOCAL_MINUTE, type AddMaintenanceInput, type MaintenanceSummary, type RemoveMaintenanceInput } from './maintenance-types';

const REVALIDATE = '/admin/agents-vehicles';

// datetime-local (Riyadh) to an ISO date-time.
function riyadh(value: string | undefined, label: string): string {
  const text = (value ?? '').trim();
  if (!LOCAL_MINUTE.test(text)) throw new InvalidInputError(`${label}: a date and time.`);
  return `${text}:00+03:00`;
}

export async function addVehicleMaintenance(input: AddMaintenanceInput): Promise<ActionResult<MaintenanceSummary>> {
  return runAction(
    async (ctx) => {
      const created = await createVehicleMaintenance(ctx, {
        vehicle_id: (pickText(input, 'vehicleId') ?? '').trim(),
        starts_at: riyadh(pickText(input, 'from'), 'From'),
        ends_at: riyadh(pickText(input, 'to'), 'To'),
        reason: (pickText(input, 'reason') ?? '').trim(),
      });
      return { id: created.id } satisfies MaintenanceSummary;
    },
    { revalidate: REVALIDATE },
  );
}

export async function removeVehicleMaintenance(input: RemoveMaintenanceInput): Promise<ActionResult<MaintenanceSummary>> {
  return runAction(
    async (ctx) => {
      const id = (pickText(input, 'id') ?? '').trim();
      await deleteVehicleMaintenance(ctx, id);
      return { id } satisfies MaintenanceSummary;
    },
    { revalidate: REVALIDATE },
  );
}
