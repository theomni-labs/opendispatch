// SPDX-License-Identifier: AGPL-3.0-only
import type { ModelVersionList } from '@/lib/types';
import type { ChallengerView, LiftView, VersionRow } from './types';

type RegistryRow = ModelVersionList['items'][number];

// Registry rows plus the engine's model first as Active
export function versionRows(
  registry: readonly RegistryRow[],
  engineModel: string | null,
  run: { readonly finished_at?: string | null; readonly engine_version?: string | null } | undefined,
  challenger: ChallengerView | null = null,
): VersionRow[] {
  const rows = engineRows(registry, engineModel, run);
  if (challenger === null || challenger.model === engineModel) return rows;
  const at = rows.findIndex((row) => row.version === challenger.model);
  const row: VersionRow = {
    id: at === -1 ? `challenger:${challenger.model}` : (rows[at] as VersionRow).id,
    version: challenger.model,
    status: 'challenger',
    trainedAt: challenger.run?.finished_at ?? (at === -1 ? null : (rows[at] as VersionRow).trainedAt),
    engine: challenger.run?.engine_version ?? (at === -1 ? null : (rows[at] as VersionRow).engine),
    placeholder: false,
    lift: challenger.lift,
  };
  const rest = rows.filter((_, i) => i !== at);
  const active = rest.findIndex((r) => r.status === 'active');
  return [...rest.slice(0, active + 1), row, ...rest.slice(active + 1)];
}

function engineRows(registry: readonly RegistryRow[], engineModel: string | null, run: { readonly finished_at?: string | null; readonly engine_version?: string | null } | undefined): VersionRow[] {
  const rows: VersionRow[] = registry.map((row) => ({
    id: row.id,
    version: row.version,
    status: engineModel === null ? row.status : row.version === engineModel ? 'active' : row.status === 'active' ? 'candidate' : row.status,
    trainedAt: row.trained_at ?? null,
    engine: row.engine_version ?? (row.version === engineModel ? (run?.engine_version ?? null) : null),
    placeholder: row.is_placeholder,
  }));
  if (engineModel === null || rows.some((row) => row.version === engineModel)) return rows;
  return [{ id: `engine:${engineModel}`, version: engineModel, status: 'active', trainedAt: run?.finished_at ?? null, engine: run?.engine_version ?? null, placeholder: false }, ...rows];
}

// The model the forecaster runs next: the champion
export function activeEngineModel(ran: string | null, champion: string | null): string | null {
  return ran === null ? null : (champion ?? ran);
}

// Why Make active is off for a row, or null
export function makeActiveBlock(row: Pick<VersionRow, 'placeholder'>, engineModel: string | null): 'placeholderOff' | null {
  return row.placeholder && engineModel !== null ? 'placeholderOff' : null;
}

// The api refused a placeholder while engines are on
export function isPlaceholderRefusal(error: { readonly code: string; readonly message: string } | null): boolean {
  return error !== null && error.code === 'conflict' && error.message === 'placeholder_not_allowed';
}

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** The backtest's lift for this challenger. */
export function liftOf(detail: unknown, challenger: string): LiftView | null {
  const comparison = typeof detail === 'object' && detail !== null ? (detail as Record<string, unknown>)['comparison'] : undefined;
  if (typeof comparison !== 'object' || comparison === null) return null;
  const c = comparison as Record<string, unknown>;
  if (text(c['challenger']) !== challenger || text(c['error']) !== '') return null;
  return { wape: num(c['wape_lift']), mape: num(c['mape_lift']) };
}
