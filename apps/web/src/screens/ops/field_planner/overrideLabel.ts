// SPDX-License-Identifier: AGPL-3.0-only
import type { Override } from '@/lib/types';

// An override row's "from → to" label: pure.

type NameOf = (agentId: string) => string | null;

const idIn = (record: unknown, key: string): string | null => {
  const value = (record ?? {}) as Readonly<Record<string, unknown>>;
  return typeof value[key] === 'string' ? value[key] : null;
};

/** From `before`, so an approval keeps it. */
export function overrideChangeLabel(o: Pick<Override, 'change_type' | 'before' | 'after'>, targetName: string | null, nameOf: NameOf): string {
  const beforeId = idIn(o.before, 'agent_id');
  const afterId = idIn(o.after, 'agent_id');
  const from = (beforeId === null ? null : nameOf(beforeId)) ?? targetName;
  const to = afterId === null ? null : nameOf(afterId);
  if (o.change_type === 'replace_agent' && from !== null && to !== null) return `${from} → ${to}`;
  if (o.change_type === 'add_assignment' && to !== null) return to;
  return from ?? '—';
}
