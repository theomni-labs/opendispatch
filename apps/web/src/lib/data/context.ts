// SPDX-License-Identifier: AGPL-3.0-only
// Request context and shared helpers.

import { createHash } from 'node:crypto';
import { cache } from 'react';
import { isInstallMode, rolesForInstallMode, zoneScopeFor, type InstallMode, type Role } from '@/lib/access';
import { DEMO_MODE_COOKIE, verifyDemoMode } from '@/lib/session/demo-session';
import type { DemoOptions as DemoOptionsBody } from '@/lib/types';
import { ForbiddenError, InvalidInputError, NotFoundError, UnauthenticatedError } from './errors';
import type { PreSessionContext, RequestContext } from './guard';
import { bindSession, oidcMode, SESSION_COOKIE } from './internal/business-client';

export type { PreSessionContext, RequestContext } from './guard';

// ---------------------------------------------------------------------------------------------
// Building the context
// ---------------------------------------------------------------------------------------------

/** True when people sign in through their identity provider (screens ask this; the demo role switcher exists only when it is false). */
export const isOidcMode = oidcMode;

function apiBase(): string {
  const base = process.env['OPENDISPATCH_API_URL'];
  if (base === undefined || base === '') throw new Error('OPENDISPATCH_API_URL is not set.');
  return base;
}

/** What Go's /me says about the signed-in person (the fields the context needs). */
interface SessionMe {
  readonly user: { readonly id: string; readonly assigned_role: Role; readonly zone_ids: readonly string[] };
  readonly tenant: { readonly id: string };
  readonly install_mode: InstallMode;
}

/** One /me call per request; unknown is none. */
const contextFromGo = cache(async (session: string): Promise<RequestContext | null> => {
  const res = await fetch(`${apiBase()}/me`, { headers: { cookie: `${SESSION_COOKIE}=${session}` }, cache: 'no-store' });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`The session check answered ${String(res.status)}.`);
  const me = (await res.json()) as SessionMe;
  const ctx: RequestContext = { customerId: me.tenant.id, userId: me.user.id, role: me.user.assigned_role, zoneScope: zoneScopeFor(me.user.assigned_role, me.user.zone_ids), installMode: me.install_mode };
  bindSession(ctx, session);
  return ctx;
});

/** The session, asked of Go; null if none. */
export async function getRequestContext(): Promise<RequestContext | null> {
  const { cookies } = await import('next/headers');
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  return session === undefined ? null : contextFromGo(session);
}

/** Like getRequestContext, but throws UnauthenticatedError when there is no valid session. */
export async function requireRequestContext(): Promise<RequestContext> {
  const ctx = await getRequestContext();
  if (ctx === null) throw new UnauthenticatedError();
  return ctx;
}

// ---------------------------------------------------------------------------------------------
// Before sign-in
// ---------------------------------------------------------------------------------------------

/** @pure The context of a visitor who has not signed in: the customer and the install mode, nothing else. */
export function buildPreSessionContext(tenantId: string, installMode: InstallMode): PreSessionContext {
  return { customerId: tenantId, installMode };
}

/** Demo only: Go's customer, the mode cookie. */
export async function getPreSessionContext(): Promise<PreSessionContext> {
  if (oidcMode()) throw new ForbiddenError('The demo sign-in is off: people sign in through their identity provider.');
  const { cookies } = await import('next/headers');
  const token = (await cookies()).get(DEMO_MODE_COOKIE)?.value;
  const options = await getDemoOptions();
  return buildPreSessionContext(options.tenantId, verifyDemoMode(token, process.env['DEMO_SESSION_SECRET'], Math.floor(Date.now() / 1000)));
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Guard of the pre-session sign-ins. */
export function requirePreSession(pre: PreSessionContext): void {
  const candidate: unknown = pre;
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) throw new ForbiddenError('Sign-in needs a pre-session context.');
  const fields = candidate as Readonly<Record<string, unknown>>;
  if (fields['role'] !== undefined || fields['userId'] !== undefined || fields['zoneScope'] !== undefined) {
    throw new ForbiddenError('A signed-in context (or one with a role) cannot be used to sign in: sign-in takes the pre-session context only.');
  }
  if (typeof fields['customerId'] !== 'string' || !UUID_SHAPE.test(fields['customerId'])) throw new ForbiddenError('Sign-in is refused: the customer is not known.');
  if (!isInstallMode(fields['installMode'])) throw new ForbiddenError('Sign-in is refused: the install mode is not known.');
}

export interface DemoOptions {
  readonly customerName: string;
  readonly customerNameAr: string;
  readonly tenantId: string;
  readonly zones: readonly { readonly id: string; readonly name: string; readonly cityName: string }[];
  readonly installModes: readonly InstallMode[];
  readonly rolesByInstallMode: Readonly<Record<InstallMode, readonly Role[]>>;
}

/** @pure The customer name in the page's language. */
export function demoCustomerName(options: Pick<DemoOptions, 'customerName' | 'customerNameAr'>, locale: string): string {
  return locale === 'ar' ? options.customerNameAr : options.customerName;
}

/** Demo only: Go's switcher list. */
// operationId: getDemoOptions
export async function getDemoOptions(): Promise<DemoOptions> {
  return demoOptionsOnce();
}

const demoOptionsOnce = cache(async (): Promise<DemoOptions> => {
  if (oidcMode()) throw new ForbiddenError('The demo sign-in is off: people sign in through their identity provider.');
  const res = await fetch(`${apiBase()}/auth/demo/options`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`The demo options answered ${String(res.status)}.`);
  const body = (await res.json()) as DemoOptionsBody;
  return {
    customerName: body.customer_name,
    customerNameAr: body.customer_name_ar ?? body.customer_name,
    tenantId: body.customer_id,
    zones: body.zones.map((z) => ({ id: z.id, name: z.name, cityName: z.city_name })),
    installModes: body.install_modes,
    rolesByInstallMode: body.roles_by_install_mode,
  };
});

// ---------------------------------------------------------------------------------------------
// Platform (shared) modules: platform.session, platform.records, platform.demo (contract x-modules)
// ---------------------------------------------------------------------------------------------

export type PlatformModule = 'platform.session' | 'platform.records' | 'platform.demo';

/**
 * platform.session and platform.demo: every role that exists in the install mode.
 * platform.records: every such role except Change Approver (contract x-modules).
 */
export function requirePlatform(ctx: RequestContext, module: PlatformModule): void {
  const exists = rolesForInstallMode(ctx.installMode).includes(ctx.role);
  const allowed = exists && (module !== 'platform.records' || ctx.role !== 'change_approver');
  if (!allowed) throw new ForbiddenError(`${ctx.role} may not use ${module} in a ${ctx.installMode} install.`);
}

// ---------------------------------------------------------------------------------------------
// Time, ids, records
// ---------------------------------------------------------------------------------------------

const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

/** ISO 8601 with +03:00, whole seconds (the fixture convention). */
export function toRiyadhIso(epochMs: number): string {
  return `${new Date(epochMs + RIYADH_OFFSET_MS).toISOString().slice(0, 19)}+03:00`;
}

/** The clock of the data layer. Tests may use fake timers. */
export function nowIso(): string {
  return toRiyadhIso(Date.now());
}

export function epochOf(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new InvalidInputError(`Not a date-time: ${iso}`);
  return ms;
}

/** YYYY-MM-DD in Riyadh time of an ISO date-time. */
export function dateOf(iso: string): string {
  return toRiyadhIso(epochOf(iso)).slice(0, 10);
}

/** A stable UUID (version 5 layout) for a name, for records that are computed and not stored. */
export function deterministicUuid(name: string): string {
  const h = createHash('sha1').update(`opendispatch:${name}`).digest();
  h[6] = ((h[6] ?? 0) & 0x0f) | 0x50;
  h[8] = ((h[8] ?? 0) & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function requireFound<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new NotFoundError(`${what} not found.`);
  return value;
}

// ---------------------------------------------------------------------------------------------
// Pagination (Go pages; this is the query shape)
// ---------------------------------------------------------------------------------------------

export interface PageQuery {
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
}

// ---------------------------------------------------------------------------------------------
// Input validation (write bodies follow the contract's *Write, *Create and *Update schemas)
// ---------------------------------------------------------------------------------------------

type Obj = Readonly<Record<string, unknown>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

function fail(what: string, key: string, problem: string): never {
  throw new InvalidInputError(`${what}: ${key} ${problem}.`);
}

/**
 * Validators. Each takes the parsed body object, the key and options, and returns the typed value or throws
 * InvalidInputError. `object(..., allowed)` also refuses unknown keys (the contract bodies are closed).
 */
export const v = {
  object(input: unknown, what: string, allowed?: readonly string[]): Obj {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new InvalidInputError(`${what}: expected an object.`);
    const o = input as Obj;
    if (allowed !== undefined) {
      const extra = Object.keys(o).filter((k) => !allowed.includes(k));
      if (extra.length > 0) throw new InvalidInputError(`${what}: unknown field ${extra.join(', ')}.`);
    }
    return o;
  },
  has(o: Obj, key: string): boolean {
    return o[key] !== undefined;
  },
  string(o: Obj, key: string, opts: { min?: number; max?: number; pattern?: RegExp } = {}): string {
    const value = o[key];
    if (typeof value !== 'string') return fail('Input', key, 'must be a string');
    if (opts.min !== undefined && value.length < opts.min) return fail('Input', key, `must have at least ${opts.min} characters`);
    if (opts.max !== undefined && value.length > opts.max) return fail('Input', key, `must have at most ${opts.max} characters`);
    if (opts.pattern !== undefined && !opts.pattern.test(value)) return fail('Input', key, 'has the wrong format');
    return value;
  },
  optString(o: Obj, key: string, opts: { min?: number; max?: number; pattern?: RegExp } = {}): string | undefined {
    return o[key] === undefined ? undefined : v.string(o, key, opts);
  },
  /** A string or null; undefined counts as null. */
  nullableString(o: Obj, key: string, opts: { min?: number; max?: number; pattern?: RegExp } = {}): string | null {
    return o[key] === undefined || o[key] === null ? null : v.string(o, key, opts);
  },
  number(o: Obj, key: string, opts: { min?: number; max?: number } = {}): number {
    const value = o[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) return fail('Input', key, 'must be a number');
    if (opts.min !== undefined && value < opts.min) return fail('Input', key, `must be at least ${opts.min}`);
    if (opts.max !== undefined && value > opts.max) return fail('Input', key, `must be at most ${opts.max}`);
    return value;
  },
  optNumber(o: Obj, key: string, opts: { min?: number; max?: number } = {}): number | undefined {
    return o[key] === undefined ? undefined : v.number(o, key, opts);
  },
  int(o: Obj, key: string, opts: { min?: number; max?: number } = {}): number {
    const value = v.number(o, key, opts);
    if (!Number.isInteger(value)) return fail('Input', key, 'must be a whole number');
    return value;
  },
  optInt(o: Obj, key: string, opts: { min?: number; max?: number } = {}): number | undefined {
    return o[key] === undefined ? undefined : v.int(o, key, opts);
  },
  bool(o: Obj, key: string): boolean {
    const value = o[key];
    if (typeof value !== 'boolean') return fail('Input', key, 'must be true or false');
    return value;
  },
  optBool(o: Obj, key: string): boolean | undefined {
    return o[key] === undefined ? undefined : v.bool(o, key);
  },
  enumOf<T extends string>(o: Obj, key: string, values: readonly T[]): T {
    const value = o[key];
    if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) return fail('Input', key, `must be one of ${values.join(', ')}`);
    return value as T;
  },
  optEnum<T extends string>(o: Obj, key: string, values: readonly T[]): T | undefined {
    return o[key] === undefined ? undefined : v.enumOf(o, key, values);
  },
  uuid(o: Obj, key: string): string {
    const value = o[key];
    if (typeof value !== 'string' || !UUID.test(value)) return fail('Input', key, 'must be a UUID');
    return value;
  },
  nullableUuid(o: Obj, key: string): string | null {
    return o[key] === undefined || o[key] === null ? null : v.uuid(o, key);
  },
  uuidList(o: Obj, key: string, opts: { optional?: boolean } = {}): string[] {
    const value = o[key];
    if (value === undefined && opts.optional === true) return [];
    if (!Array.isArray(value)) return fail('Input', key, 'must be a list of UUIDs');
    for (const item of value) if (typeof item !== 'string' || !UUID.test(item)) return fail('Input', key, 'must be a list of UUIDs');
    return [...new Set(value as string[])];
  },
  stringList(o: Obj, key: string, opts: { min?: number; maxItems?: number; max?: number } = {}): string[] {
    const value = o[key];
    if (!Array.isArray(value)) return fail('Input', key, 'must be a list of strings');
    if (opts.min !== undefined && value.length < opts.min) return fail('Input', key, `must have at least ${opts.min} items`);
    if (opts.maxItems !== undefined && value.length > opts.maxItems) return fail('Input', key, `must have at most ${opts.maxItems} items`);
    for (const item of value) {
      if (typeof item !== 'string') return fail('Input', key, 'must be a list of strings');
      if (opts.max !== undefined && item.length > opts.max) return fail('Input', key, `items must have at most ${opts.max} characters`);
    }
    return [...(value as string[])];
  },
  enumList<T extends string>(o: Obj, key: string, values: readonly T[], opts: { min?: number } = {}): T[] {
    const list = v.stringList(o, key, opts);
    for (const item of list) if (!(values as readonly string[]).includes(item)) return fail('Input', key, `items must be one of ${values.join(', ')}`);
    return [...new Set(list)] as T[];
  },
  date(o: Obj, key: string): string {
    const value = o[key];
    if (typeof value !== 'string' || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return fail('Input', key, 'must be a date (YYYY-MM-DD)');
    return value;
  },
  optDate(o: Obj, key: string): string | undefined {
    return o[key] === undefined ? undefined : v.date(o, key);
  },
  time(o: Obj, key: string): string {
    const value = o[key];
    if (typeof value !== 'string' || !TIME.test(value)) return fail('Input', key, 'must be a time (HH:MM)');
    return value;
  },
  dateTime(o: Obj, key: string): string {
    const value = o[key];
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || !value.includes('T')) return fail('Input', key, 'must be a date-time');
    return value;
  },
  optDateTime(o: Obj, key: string): string | undefined {
    return o[key] === undefined ? undefined : v.dateTime(o, key);
  },
  extra(o: Obj, key: string): Record<string, unknown> | undefined {
    const value = o[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail('Input', key, 'must be an object');
    return value as Record<string, unknown>;
  },
};

/** Keeps only defined values, for building records under exactOptionalPropertyTypes. */
export function defined<T extends Record<string, unknown>>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> };
}
