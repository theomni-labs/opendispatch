// SPDX-License-Identifier: AGPL-3.0-only
// Shared context and small helpers for the fixture builders. Node-free.

import { calibration } from './calibration';
import { buildWorld, type World } from './people';
import { uuidFor } from './rng';
import { iso, parseIso } from './time';

export type DataSource = 'SYNTHETIC';
export type Rec = Record<string, unknown>;

export interface BaseFields {
  readonly id: string;
  readonly tenant_id: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly created_by: string | null;
  readonly data_source: DataSource;
}

export interface Ctx {
  readonly seed: string;
  readonly tenantId: string;
  readonly world: World;
  /** When the reference data was seeded (before the case week). */
  readonly seededAt: number;
  /** The demo's "now" before the replay starts: the morning of the demo day. */
  readonly demoNow: number;
  readonly demoToday: string;
  readonly firstCaseDay: string;
  readonly lastCaseDay: string;
}

export function makeCtx(): Ctx {
  const s = calibration.structure;
  return {
    seed: s.seed.value,
    tenantId: s.customer.id.value,
    world: buildWorld(s.seed.value),
    seededAt: parseIso('2026-09-05T20:00:00+03:00'),
    demoNow: parseIso(`${s.demo_today.value}T06:00:00+03:00`),
    demoToday: s.demo_today.value,
    firstCaseDay: s.first_case_day.value,
    lastCaseDay: s.last_case_day.value,
  };
}

/** The id, tenant and bookkeeping fields every record carries, in a fixed order. */
export function base(ctx: Ctx, kind: string, key: string, createdAt: number, updatedAt: number = createdAt, createdBy: string | null = null): BaseFields {
  return {
    id: uuidFor(ctx.seed, kind, key),
    tenant_id: ctx.tenantId,
    created_at: iso(createdAt),
    updated_at: iso(updatedAt),
    created_by: createdBy,
    data_source: 'SYNTHETIC',
  };
}

export function idOf(ctx: Ctx, kind: string, key: string): string {
  return uuidFor(ctx.seed, kind, key);
}

export const round = (x: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};

/** Coordinates written to 6 decimals (about 0.1 m). */
export const coord = (x: number): number => Math.round(x * 1e6) / 1e6;
