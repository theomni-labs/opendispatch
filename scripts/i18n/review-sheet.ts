// SPDX-License-Identifier: AGPL-3.0-only
// The native-reader sheet: every Arabic key that is still a draft, with its English text, as CSV.
//
//   pnpm exec tsx scripts/i18n/review-sheet.ts                    all drafts, to the terminal
//   pnpm exec tsx scripts/i18n/review-sheet.ts --module users_roles
//   pnpm exec tsx scripts/i18n/review-sheet.ts --out /tmp/arabic-review.csv
//   pnpm exec tsx scripts/i18n/review-sheet.ts --count            only the numbers (for docs/)
//
// Columns: scope, key, English, Arabic, status. The reader returns corrections in the Arabic column; a person (or a small
// script) puts them in apps/web/messages/... and sets the key to "reviewed" in apps/web/messages/ar.status.json. The file has
// a UTF-8 byte order mark so Excel shows the Arabic, and cells that look like formulas are neutralised (toCsv).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toCsv, type CsvCell } from '../../apps/web/src/lib/export/csv';
import { ROOT, leaves, paths, type Tree as MessageTree } from './status.mjs';

type Status = Record<string, Record<string, 'draft' | 'reviewed'> | string>;

const readJson = <T>(file: string, fallback: T): T => (fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as T) : fallback);

export interface SheetRow {
  readonly scope: string;
  readonly key: string;
  readonly english: string;
  readonly arabic: string;
  readonly status: 'draft' | 'reviewed';
}

/** Every tracked Arabic key with its English text and status. `scope` limits it to one (`core`, `admin.users_roles`, `ops.gap_surplus`). */
export function sheetRows(root: string = ROOT, only?: string): SheetRow[] {
  const p = paths(root);
  const status = readJson<Status>(p.status, {});
  const rows: SheetRow[] = [];
  for (const [scope, keys] of Object.entries(status)) {
    if (scope.startsWith('$') || typeof keys === 'string') continue;
    if (only !== undefined && scope !== only && scope !== `admin.${only}` && scope !== `ops.${only}`) continue;
    const english = leaves(readJson<MessageTree>(p.scope(scope, 'en'), {}));
    const arabic = leaves(readJson<MessageTree>(p.scope(scope, 'ar'), {}));
    for (const [key, state] of Object.entries(keys)) rows.push({ scope, key, english: english[key] ?? '', arabic: arabic[key] ?? '', status: state });
  }
  return rows;
}

/** The sheet as CSV text: drafts only, unless `all`. */
export function reviewSheet(rows: readonly SheetRow[], all = false): string {
  const shown = rows.filter((row) => all || row.status === 'draft');
  return toCsv({ header: ['Scope', 'Key', 'English', 'Arabic', 'Status'], rows: shown.map((row): CsvCell[] => [row.scope, row.key, row.english, row.arabic, row.status]) });
}

export function counts(rows: readonly SheetRow[]): { draft: number; reviewed: number; byScope: Record<string, number> } {
  const byScope: Record<string, number> = {};
  for (const row of rows) if (row.status === 'draft') byScope[row.scope] = (byScope[row.scope] ?? 0) + 1;
  return { draft: rows.filter((r) => r.status === 'draft').length, reviewed: rows.filter((r) => r.status === 'reviewed').length, byScope };
}

function main(argv: readonly string[]): number {
  const value = (name: string) => {
    const at = argv.indexOf(`--${name}`);
    return at === -1 ? undefined : argv[at + 1];
  };
  const rows = sheetRows(ROOT, value('module'));
  if (argv.includes('--count')) {
    const c = counts(rows);
    console.log(`Arabic keys: ${c.draft} draft, ${c.reviewed} reviewed`);
    for (const [scope, n] of Object.entries(c.byScope)) console.log(`  ${scope}: ${n} draft`);
    return 0;
  }
  const text = reviewSheet(rows, argv.includes('--all'));
  const out = value('out');
  if (out === undefined) process.stdout.write(`${text}\n`);
  else fs.writeFileSync(path.resolve(out), text);
  return 0;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
