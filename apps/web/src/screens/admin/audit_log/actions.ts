'use server';
// SPDX-License-Identifier: AGPL-3.0-only

// The one action of the Audit Log: Export. The log is append only, so the screen has no write.
//
//   exportAuditLog   the events of the filter a person has on screen, as a CSV file `{ filename, mime, text }` the browser saves.
//
// Rule 2: the action takes what the person typed or chose (search text, outcome, category, period) and nothing else: no
// context, customer, user, role, zone scope or install mode. It builds its own context with requireRequestContext() inside
// runAction and reads through the same data function as the page, so a role that may not read the log gets `forbidden`.
// Reading and exporting are not audited. The file holds the newest EXPORT_LIMIT events; the columns are the record's own field
// names, as the log's Detail block writes them.

import { pickText } from '@/lib/actions/pick';
import { runAction } from '@/lib/actions/run-action';
import type { ActionResult } from '@/lib/actions/types';
import { InvalidInputError } from '@/lib/data/errors';
import { actorNames } from '@/components/opendispatch/patterns/audit-actors';
import { param, parseSearchParams } from '@/components/opendispatch/patterns/search-params';
import { CSV_MIME, toCsv, type CsvCell } from '@/lib/export/csv';
import type { ExportFile } from '@/lib/export/download';
import { AUDIT_CATEGORIES, AUDIT_PERIODS, type ExportFilter } from './types';
import { EXPORT_LIMIT, filterOf, readEvents } from './view';

const HEADER = ['occurred_at', 'actor', 'actor_type', 'action', 'entity_type', 'entity_id', 'outcome', 'summary_en', 'correlation_id'] as const;
const OUTCOMES = ['success', 'denied'] as const;

/** A filter the person did not choose is left out; one that is not on the allow-list is refused, so an export is never wider than asked. */
function checkedFilter(input: unknown) {
  const raw = { q: pickText(input, 'q'), outcome: pickText(input, 'outcome'), cat: pickText(input, 'category'), period: pickText(input, 'period') };
  const given = Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== ''));
  const parsed = parseSearchParams(given, { q: param.text(80), outcome: param.enum(OUTCOMES), cat: param.enum(AUDIT_CATEGORIES), period: param.enum(AUDIT_PERIODS) });
  for (const key of ['outcome', 'cat', 'period'] as const) {
    if (given[key] !== undefined && parsed[key] === undefined) throw new InvalidInputError(`Audit export: "${key === 'cat' ? 'category' : key}" is not one of the filters.`);
  }
  return parsed;
}

export async function exportAuditLog(input: ExportFilter): Promise<ActionResult<ExportFile>> {
  return runAction(async (ctx) => {
    const query = checkedFilter(input);
    const now = new Date();
    const { events } = await readEvents(ctx, filterOf(query, now.getTime()), 0, EXPORT_LIMIT);
    const names = await actorNames(ctx, events);
    const rows: CsvCell[][] = events.map((event) => [
      event.occurred_at,
      event.actor_user_id === null || event.actor_user_id === undefined ? '' : (names[event.actor_user_id] ?? ''),
      event.actor_type,
      event.action,
      event.entity_type,
      event.entity_id ?? '',
      event.outcome,
      event.summary_en,
      event.correlation_id ?? '',
    ]);
    return { filename: `audit-log-${now.toISOString().slice(0, 10)}.csv`, mime: CSV_MIME, text: toCsv({ header: [...HEADER], rows }) } satisfies ExportFile;
  });
}
