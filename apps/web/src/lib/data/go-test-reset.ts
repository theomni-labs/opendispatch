// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { zoneScopeFor, type InstallMode, type Role } from '@/lib/access';
import type { User, Zone } from '@/lib/types';
import { InvalidInputError } from './errors';
import type { RequestContext } from './guard';
import { setTestSessionSource } from './internal/business-client';
import { fixtureRecords, fixturesDir } from './internal/fixtures';

export function fixtureUsers(): readonly User[] {
  return fixtureRecords<User>('User');
}

// Resets Go's in-memory state; no test runner import.
export async function resetGoTestState(): Promise<void> {
  const url = process.env['OPENDISPATCH_API_URL'];
  if (url === undefined || url === '') return;
  try {
    await fetch(`${url}/_internal/test/reset`, { method: 'POST' });
  } catch {
    // best effort
  }
}

// Makes Go's clock follow the faked Date (or the real one, with no fake).
export async function syncGoClock(): Promise<void> {
  const url = process.env['OPENDISPATCH_API_URL'];
  if (url === undefined || url === '') return;
  await fetch(`${url}/_internal/test/clock`, { method: 'POST', body: JSON.stringify({ now: new Date(Date.now()).toISOString() }) });
}

// Sets update-agent state that no call reaches.
export async function patchGoUpdatesState(patch: { readonly index_valid_until?: string; readonly release_states?: Readonly<Record<string, string>> }): Promise<void> {
  const url = process.env['OPENDISPATCH_API_URL'];
  if (url === undefined || url === '') throw new Error('OPENDISPATCH_API_URL is not set.');
  const res = await fetch(`${url}/_internal/test/updates-state`, { method: 'POST', body: JSON.stringify(patch) });
  if (!res.ok) throw new Error(`updates-state patch failed: ${res.status}`);
}

/** How many audit events Go holds for the demo tenant. */
export async function goAuditCount(): Promise<number> {
  const url = process.env['OPENDISPATCH_API_URL'];
  if (url === undefined || url === '') throw new Error('OPENDISPATCH_API_URL is not set.');
  const res = await fetch(`${url}/_internal/test/audit-count`);
  if (!res.ok) throw new Error(`audit-count failed: ${res.status}`);
  return ((await res.json()) as { count: number }).count;
}

export interface TestAuditInput {
  readonly action: string;
  readonly entity_type: string;
  readonly entity_id?: string | null | undefined;
  readonly summary_en: string;
  readonly detail?: Readonly<Record<string, unknown>> | undefined;
  readonly outcome?: string | undefined;
  readonly user_id?: string | undefined;
}

export interface RawRequest {
  readonly tenantId: string;
  readonly method?: 'GET' | 'POST' | undefined;
  readonly body?: unknown;
}

/** Go's raw /_internal routes (tests only); undefined on a GET 404. */
export async function goRawFetch<T>(path: string, req: RawRequest): Promise<T | undefined> {
  const url = process.env['OPENDISPATCH_API_URL'];
  if (url === undefined || url === '') throw new Error('OPENDISPATCH_API_URL is not set.');
  const method = req.method ?? 'GET';
  const res = await fetch(`${url}${path}`, {
    method,
    headers: { 'x-opendispatch-tenant-id': req.tenantId, 'content-type': 'application/json' },
    cache: 'no-store',
    ...(req.body === undefined ? {} : { body: JSON.stringify(req.body) }),
  });
  if (res.status === 404 && method === 'GET') return undefined;
  if (!res.ok) throw new Error(`${method} ${path} failed: ${String(res.status)}`);
  return res.status === 204 ? undefined : ((await res.json()) as T);
}

/** Seeds one event in Go's audit log (tests only). Refused input answers like any Go call. */
export async function goRecordAudit<T>(input: TestAuditInput): Promise<T> {
  const url = process.env['OPENDISPATCH_API_URL'];
  if (url === undefined || url === '') throw new Error('OPENDISPATCH_API_URL is not set.');
  const res = await fetch(`${url}/_internal/test/audit-event`, { method: 'POST', body: JSON.stringify(input) });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new InvalidInputError(body.error ?? `audit-event failed: ${res.status}`);
  return body as T;
}

/** The fixtures' customer id. */
export function fixtureTenantId(): string {
  const raw = JSON.parse(fs.readFileSync(path.join(fixturesDir(), 'manifest.json'), 'utf8')) as { tenant_id?: unknown };
  if (typeof raw.tenant_id !== 'string' || raw.tenant_id === '') throw new Error('fixtures/manifest.json has no tenant_id.');
  return raw.tenant_id;
}

/** A demo switcher choice. */
export interface DemoChoice {
  readonly role: Role;
  readonly installMode: InstallMode;
  readonly zoneIds: readonly string[];
}

/** Go's demo pick in TS; null when none. */
export function buildContext(choice: DemoChoice, users: readonly User[], tenantId: string, knownZoneIds?: readonly string[]): RequestContext | null {
  const known = new Set(knownZoneIds ?? fixtureRecords<Zone>('Zone').map((z) => z.id));
  const zoneIds = choice.zoneIds.filter((id) => known.has(id));
  const candidates = users.filter((u) => u.assigned_role === choice.role && u.status === 'active' && !u.is_emergency_admin);
  const wanted = [...zoneIds].sort().join('|');
  const user = candidates.find((u) => [...u.zone_ids].sort().join('|') === wanted) ?? candidates[0];
  if (user === undefined) return null;
  return { customerId: tenantId, userId: user.id, role: choice.role, zoneScope: zoneScopeFor(choice.role, zoneIds), installMode: choice.installMode };
}

const sessions = new Map<string, Promise<string | null>>();

/** One Go test session per context shape. */
function testSession(ctx: RequestContext, renew: boolean): Promise<string | null> {
  const url = process.env['OPENDISPATCH_API_URL'];
  if (url === undefined || url === '') return Promise.resolve(null);
  if (typeof ctx.zoneScope !== 'object') return Promise.resolve(null);
  const zones = ctx.zoneScope.kind === 'assigned_zones' ? ctx.zoneScope.zoneIds : [];
  const key = JSON.stringify([url, ctx.userId, ctx.role, ctx.installMode, zones]);
  const hit = sessions.get(key);
  if (hit !== undefined && !renew) return hit;
  const made = fetch(`${url}/_internal/test/demo-session`, {
    method: 'POST',
    body: JSON.stringify({ user_id: ctx.userId, assigned_role: ctx.role, install_mode: ctx.installMode, zone_ids: zones }),
  }).then(async (res) => (res.ok ? ((await res.json()) as { token: string }).token : null));
  sessions.set(key, made);
  made.catch(() => sessions.delete(key));
  return made;
}

setTestSessionSource(testSession);
