// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import { formatMessage, type MessageValues } from '../../apps/web/src/i18n/format-message';
import type { Locale } from '../routes';
import { readMessages } from '../messages';

type Tree = { [key: string]: string | Tree };
export type Message = (locale: Locale, key: string, values?: MessageValues) => string;

const MESSAGES = path.join(import.meta.dirname, '../../apps/web/messages');

// A module's messages, e.g. ops/field_planner.
export function messages(mod: string): Message {
  const read = (locale: Locale): Tree => readMessages(path.join(MESSAGES, mod, `${locale}.json`)) as Tree;
  const trees: Record<Locale, Tree> = { en: read('en'), ar: read('ar') };
  return (locale, key, values) => {
    let node: string | Tree | undefined = trees[locale];
    for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined;
    if (typeof node !== 'string') throw new Error(`No message ${mod}.${locale}:${key}`);
    // no values: the raw text, holes and all
    return values === undefined ? node : formatMessage(locale, node, numeric(values));
  };
}

// Digit strings as numbers, so plurals pick a form.
const numeric = (values: MessageValues): MessageValues =>
  Object.fromEntries(Object.entries(values).map(([name, value]) => [name, typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value]));

// Counts that reach every Arabic plural form.
const PLURAL_SAMPLES = [0, 1, 2, 3, 11, 100];

// Each plural form of a message, `name` as a hole.
export function pluralForms(format: (values: MessageValues) => string, name: string): string[] {
  const forms = PLURAL_SAMPLES.map((n) => format({ [name]: n }).replaceAll(String(n), `{${name}}`));
  return [...new Set(forms)];
}

// A message (or its forms) with {name} holes, as a RegExp.
export function pattern(message: string | readonly string[]): RegExp {
  const one = (text: string) => text.split(/\{[a-z]+\}/i).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.+?)');
  return new RegExp(typeof message === 'string' ? one(message) : message.map(one).join('|'));
}

// The first hole a pattern() match filled.
export const firstHole = (match: RegExpExecArray): string | undefined => match.slice(1).find((part) => part !== undefined);

// The number of the Stat labelled `label`.
export async function statValue(scope: Locator, label: string): Promise<number> {
  const stat = scope.locator(`xpath=.//div[div/span[normalize-space(.)=${JSON.stringify(label)}] and .//bdi]`).first();
  const raw = (await stat.locator('bdi').first().textContent()) ?? '';
  const value = Number(raw.replace(/[^\d.-]/g, ''));
  if (raw.trim() === '' || Number.isNaN(value)) throw new Error(`Stat "${label}" has no number: "${raw}"`);
  return value;
}

// Audit rows for `query`; one has `action`.
export async function expectAudit(page: Page, locale: Locale, query: string, action: string): Promise<Locator> {
  await page.goto(`/${locale}/admin/audit-log?q=${encodeURIComponent(query)}`);
  const row = page.locator('[data-module="admin.audit_log"] tbody tr').filter({ hasText: action }).first();
  await expect(row, `audit row ${action} for "${query}"`).toBeVisible();
  return row;
}

// Opens an audit row; returns its JSON.
export async function auditDetail(page: Page, row: Locator): Promise<string> {
  await row.click();
  const json = page.getByRole('dialog').locator('pre');
  await expect(json).toBeVisible();
  return (await json.textContent()) ?? '';
}

// The Go api the screens read, as the page's user.
export interface Api {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
}

export async function apiAs(page: Page, apiUrl: string | undefined): Promise<Api> {
  const base = apiUrl ?? process.env['OPENDISPATCH_API_URL'];
  if (base === undefined || base === '') throw new Error('No api url for the flow.');
  const session = (await page.context().cookies()).find((c) => c.name === 'opendispatch_session');
  if (session === undefined) throw new Error('Not signed in.');
  const call = async <T>(path: string, init: RequestInit): Promise<T> => {
    const res = await fetch(`${base}${path}`, { ...init, headers: { cookie: `opendispatch_session=${session.value}`, 'content-type': 'application/json' } });
    if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${String(res.status)} ${await res.text()}`);
    return (await res.json()) as T;
  };
  return {
    get: (path) => call(path, {}),
    post: (path, body) => call(path, { method: 'POST', body: JSON.stringify(body) }),
  };
}

interface GapCell {
  readonly interval_index: number;
  readonly delta: number;
  readonly kind: string;
}

export interface Line {
  readonly id: string;
  readonly agent_id: string;
  readonly start_at: string;
  readonly end_at: string;
  readonly break_start_at: string | null;
  readonly break_end_at: string | null;
  readonly vehicle_id: string | null;
}

const quarterOf = (at: string, date: string) => Math.floor((Date.parse(at) - Date.parse(`${date}T00:00:00+03:00`)) / 900_000);

// Quarters a line counts in the gap view.
function dutyOf(line: Line, date: string): number[] {
  if (line.vehicle_id === null) return [];
  const away = new Set<number>();
  if (line.break_start_at !== null && line.break_end_at !== null) {
    for (let i = quarterOf(line.break_start_at, date); i < quarterOf(line.break_end_at, date); i++) away.add(i);
  }
  const out: number[] = [];
  for (let i = Math.max(quarterOf(line.start_at, date), 0); i < Math.min(quarterOf(line.end_at, date), 96); i++) if (!away.has(i)) out.push(i);
  return out;
}

export interface TightLine {
  readonly line: Line;
  // Intervals that become gaps without it.
  readonly newGaps: number;
}

// Day's roster lines on exactly staffed intervals.
export async function tightLines(api: Api, zoneId: string, date: string): Promise<TightLine[]> {
  const rosters = await api.get<{ items: { id: string; zone_id: string; roster_date: string }[] }>(`/rosters?zone_id=${zoneId}&date=${date}`);
  const roster = rosters.items.find((r) => r.zone_id === zoneId && r.roster_date === date);
  if (roster === undefined) return [];
  const gaps = await api.get<{ cells: GapCell[] }>(`/gaps?zone_id=${zoneId}&date=${date}`);
  const exact = new Set(gaps.cells.filter((c) => c.kind !== 'gap' && c.delta === 0).map((c) => c.interval_index));
  const lines = await api.get<{ items: Line[] }>(`/rosters/${roster.id}/assignments?limit=200`);
  return lines.items
    .map((line) => ({ line, newGaps: dutyOf(line, date).filter((i) => exact.has(i)).length }))
    .filter((t) => t.newGaps > 0)
    .sort((a, b) => b.newGaps - a.newGaps);
}
