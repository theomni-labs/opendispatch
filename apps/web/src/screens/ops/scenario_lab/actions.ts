'use server';
// SPDX-License-Identifier: AGPL-3.0-only

// Scenario Lab writes

import { pickFields, pickText, pickTextList } from '@/lib/actions/pick';
import { runAction } from '@/lib/actions/run-action';
import type { ActionResult } from '@/lib/actions/types';
import { draftScenarioWithAssistant } from '@/lib/data/assistant';
import { DataError, InvalidInputError } from '@/lib/data/errors';
import { createScenario, deleteScenario, getScenario, runScenario, updateScenario } from '@/lib/data/scenarios';
import type { Scenario } from '@/lib/types';
import { remoteDeltas } from './changes';
import type { BulkDeleteResult, DraftScenarioInput, DuplicateScenarioInput, RunScenarioInput, SaveScenarioInput, ScenarioDraftResult, ScenarioTarget, ScenarioTargets } from './types';

const REVALIDATE = '/ops/scenario-lab';
const MAX_BULK = 100;

interface RunSummary {
  readonly id: string;
  readonly gaps: number;
  readonly surplus: number;
}

interface ScenarioTargetSummary {
  readonly id: string;
  readonly name: string;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function bodyOf(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const zoneIds = Array.isArray(fields['zoneIds']) ? (fields['zoneIds'] as unknown[]).filter((z): z is string => typeof z === 'string') : [];
  const field = numberOf(fields['field']);
  const veh = numberOf(fields['veh']);
  const rawByZone = fields['remoteByZone'];
  const byZone: Record<string, number> = {};
  if (typeof rawByZone === 'object' && rawByZone !== null) {
    for (const zoneId of zoneIds) {
      if (Object.hasOwn(rawByZone, zoneId)) byZone[zoneId] = numberOf((rawByZone as Readonly<Record<string, unknown>>)[zoneId]);
    }
  }
  const mode = fields['remoteMode'] === 'zone' ? 'zone' : 'company';
  const remote = remoteDeltas({ mode, company: numberOf(fields['remote']), byZone }, zoneIds);
  const headcountDelta = zoneIds
    .map((zoneId) => ({
      zone_id: zoneId,
      ...(field === 0 ? {} : { field_agents: field }),
      ...(remote[zoneId] === undefined ? {} : { remote_agents: remote[zoneId] }),
      ...(veh === 0 ? {} : { vehicles: veh }),
    }))
    .filter((entry) => Object.keys(entry).length > 1);
  const share = fields['sharePercent'];
  const remoteShare = typeof share === 'number' && Number.isFinite(share) ? share / 100 : null;
  const patternIds = Array.isArray(fields['patternIds']) ? (fields['patternIds'] as unknown[]).filter((p): p is string => typeof p === 'string') : [];
  return {
    name: textOf(fields['name']),
    base_date: fields['baseDate'],
    zone_ids: zoneIds,
    adjustments: { headcount_delta: headcountDelta, shift_pattern_ids: patternIds, remote_share: remoteShare },
  };
}

/** Drafts or changes a scenario. */
export async function saveScenarioAction(input: SaveScenarioInput): Promise<ActionResult<Scenario>> {
  return runAction(
    async (ctx) => {
      const fields = pickFields(input, ['id', 'name', 'baseDate', 'zoneIds', 'field', 'remote', 'remoteMode', 'remoteByZone', 'veh', 'sharePercent', 'patternIds']);
      const body = bodyOf(fields);
      const id = typeof fields['id'] === 'string' && fields['id'] !== '' ? fields['id'] : undefined;
      return id === undefined ? createScenario(ctx, body) : updateScenario(ctx, id, body);
    },
    { revalidate: REVALIDATE },
  );
}

/** Recomputes a saved scenario's gap and SLA. */
export async function runScenarioAction(input: RunScenarioInput): Promise<ActionResult<RunSummary>> {
  return runAction(
    async (ctx) => {
      const id = pickText(input, 'id') ?? '';
      const result = await runScenario(ctx, id);
      const gaps = result.optimizer.gap_cells.filter((c) => c.kind === 'gap').length;
      const surplus = result.optimizer.gap_cells.filter((c) => c.kind === 'surplus').length;
      return { id, gaps, surplus } satisfies RunSummary;
    },
    { revalidate: REVALIDATE },
  );
}

/** Deletes a scenario. */
export async function deleteScenarioAction(input: ScenarioTarget): Promise<ActionResult<ScenarioTargetSummary>> {
  return runAction(
    async (ctx) => {
      const id = pickText(input, 'id') ?? '';
      // Name only for the toast; delete audits
      const name = await (async (): Promise<string> => {
        try {
          return (await getScenario(ctx, id)).name;
        } catch {
          return '';
        }
      })();
      await deleteScenario(ctx, id);
      return { id, name } satisfies ScenarioTargetSummary;
    },
    { revalidate: REVALIDATE },
  );
}

/** Deletes several; stops on a caller refusal. */
export async function deleteScenariosAction(input: ScenarioTargets): Promise<ActionResult<BulkDeleteResult>> {
  return runAction(
    async (ctx) => {
      const ids = pickTextList(input, 'ids', MAX_BULK);
      if (ids === undefined || ids.length === 0) throw new InvalidInputError(`Scenarios: name 1 to ${String(MAX_BULK)}.`);
      let deleted = 0;
      let failed = 0;
      for (const id of [...new Set(ids)]) {
        try {
          await deleteScenario(ctx, id);
          deleted += 1;
        } catch (error) {
          if (!(error instanceof DataError) || error.code === 'forbidden' || error.code === 'unauthenticated') throw error;
          failed += 1;
        }
      }
      return { deleted, failed } satisfies BulkDeleteResult;
    },
    { revalidate: REVALIDATE },
  );
}

/** Copies zones, date, adjustments into a draft. */
export async function duplicateScenarioAction(input: DuplicateScenarioInput): Promise<ActionResult<Scenario>> {
  return runAction(
    async (ctx) => {
      const id = pickText(input, 'id') ?? '';
      const source = await getScenario(ctx, id);
      return createScenario(ctx, {
        name: `${source.name} (2)`,
        base_date: source.base_date,
        zone_ids: source.zone_ids,
        adjustments: source.adjustments,
      });
    },
    { revalidate: REVALIDATE },
  );
}

/** Drafts editor values from plain language; saves nothing. */
export async function draftScenarioAction(input: DraftScenarioInput): Promise<ActionResult<ScenarioDraftResult>> {
  return runAction(async (ctx) => {
    const out = await draftScenarioWithAssistant(ctx, { text: pickText(input, 'text') ?? '', locale: pickText(input, 'locale') === 'ar' ? 'ar' : 'en' });
    const d = out.draft;
    const remoteByZone = Object.fromEntries(d.remote_by_zone.map((r) => [r.zone_id, r.remote_agents] as const));
    return {
      provider: out.provider,
      model: out.model,
      duration_ms: out.duration_ms,
      form: {
        name: d.name,
        baseDate: d.base_date,
        zoneIds: d.zone_ids,
        field: d.field_agents,
        remote: d.remote_mode === 'company' ? d.remote_agents : 0,
        remoteMode: d.remote_mode,
        remoteByZone,
        veh: d.vehicles,
        sharePercent: d.remote_share_percent ?? null,
        patternIds: d.shift_pattern_ids,
      },
      unmapped: out.unmapped,
    } satisfies ScenarioDraftResult;
  });
}
