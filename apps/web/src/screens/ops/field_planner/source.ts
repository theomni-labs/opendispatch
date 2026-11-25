// SPDX-License-Identifier: AGPL-3.0-only
import type { Roster } from '@/lib/types';

// Where a roster's lines came from. Pure.

export type FallbackReason = NonNullable<Roster['fallback_reason']>;
export type OptimizerStatus = NonNullable<Roster['optimizer_status']>;
export type SolverStatus = NonNullable<Roster['solver_status']>;

export type RosterSource =
  | { readonly kind: 'optimizer'; readonly status: OptimizerStatus | null }
  | { readonly kind: 'fallback'; readonly reason: FallbackReason };

export interface SourceChip {
  readonly tone: 'neutral' | 'success' | 'warning';
  readonly label: string;
  readonly note: string | null;
}

type Pick3 = Pick<Roster, 'optimizer_source' | 'fallback_reason' | 'optimizer_status'>;

// Null: built before the field, or engines off
export function rosterSourceOf(roster: Partial<Pick3>): RosterSource | null {
  if (roster.optimizer_source === 'optimizer') return { kind: 'optimizer', status: roster.optimizer_status ?? null };
  if (roster.optimizer_source === 'fallback') return { kind: 'fallback', reason: roster.fallback_reason ?? 'no_answer' };
  return null;
}

// m: the module's translator
export function sourceChipOf(source: RosterSource, m: (key: string) => string): SourceChip {
  if (source.kind === 'fallback') return { tone: 'warning', label: m('source.fallback'), note: m(`source.reason.${source.reason}`) };
  const label = source.status === null ? m('source.optimizer') : `${m('source.optimizer')} · ${m(`source.status.${source.status}`)}`;
  const note = source.status === 'partial' || source.status === 'infeasible' ? m(`source.note.${source.status}`) : null;
  return { tone: source.status === 'feasible' ? 'success' : 'neutral', label, note };
}

// The model family's label key
export function modelFamilyKey(model: string): 'model.cpsat' | 'model.greedy' {
  return model.startsWith('cpsat') ? 'model.cpsat' : 'model.greedy';
}
