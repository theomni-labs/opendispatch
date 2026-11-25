// SPDX-License-Identifier: AGPL-3.0-only
// Plain data of vehicle maintenance (spec 4.4).

export interface MaintenanceItem {
  readonly id: string;
  // ISO date-times, +03:00.
  readonly from: string;
  readonly to: string;
  readonly reason: string;
  // Overlaps the demo day.
  readonly active: boolean;
}

export type MaintenanceByVehicle = Readonly<Record<string, readonly MaintenanceItem[]>>;

export interface AddMaintenanceInput {
  readonly vehicleId: string;
  // datetime-local values, Asia/Riyadh.
  readonly from: string;
  readonly to: string;
  readonly reason: string;
}

export interface RemoveMaintenanceInput {
  readonly id: string;
}

export interface MaintenanceSummary {
  readonly id: string;
}

export const LOCAL_MINUTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
