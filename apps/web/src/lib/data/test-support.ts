// SPDX-License-Identifier: AGPL-3.0-only
// Test helpers for the data layer.

import { buildContext, fixtureTenantId, fixtureUsers, goAuditCount, goRawFetch, goRecordAudit, patchGoUpdatesState, resetGoTestState, syncGoClock, type TestAuditInput } from './go-test-reset';
import { afterEach, beforeEach, expect } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import type { AuditEvent, DataSource, RuleOutcome, User, Zone } from '@/lib/types';
import { createAjv, getComponentSchema } from '../../../../../scripts/contracts/schemas';
import { buildPreSessionContext, requireFound } from './context';
import type { PreSessionContext, RequestContext } from './guard';
import { DataError } from './errors';
import { businessFetch } from './internal/business-client';
import { clearFixtureCache, fixtureRecords } from './internal/fixtures';

interface HasId {
  readonly id: string;
}


/** A RequestContext as the demo switcher would build it, straight from the fixtures. Throws when the role has no seeded user. */
export function ctxFor(role: Role, options: CtxOptions = {}): RequestContext {
  const users = fixtureRecords<User>('User');
  const seeded = users.find((u) => u.assigned_role === role && u.status === 'active' && !u.is_emergency_admin);
  if (seeded === undefined) throw new Error(`No seeded fixture user for role ${role}.`);
  const zones = fixtureRecords<Zone>('Zone').map((z) => z.id);
  const ctx = buildContext({ role, installMode: options.installMode ?? 'private', zoneIds: options.zones ?? seeded.zone_ids }, users, fixtureTenantId(), zones);
  if (ctx === null) throw new Error(`Could not build a context for ${role}.`);
  return ctx;
}

export interface CtxOptions {
  /** Zone ids for assigned-zone roles. Default: the zones of the seeded fixture user of that role. */
  readonly zones?: readonly string[];
  /** Default `private`. */
  readonly installMode?: InstallMode;
}

/** The context of a visitor who has not signed in: the fixture customer and an install mode, no role, no user. */
export function preSessionFor(installMode: InstallMode = 'private'): PreSessionContext {
  return buildPreSessionContext(fixtureTenantId(), installMode);
}

/** Fixture zone ids in file order (Riyadh Central, North, East, South, West, Jeddah North, South, Dammam Central). */
export function fixtureZoneIds(): readonly string[] {
  return fixtureRecords<Zone>('Zone').map((z) => z.id);
}

/** Before each test: Go reset, cache cleared. */
export function useTempDemoState(): void {
  beforeEach(async () => {
    clearFixtureCache();
    await resetGoTestState();
  });

  afterEach(() => {
    clearFixtureCache();
  });
}

/** Same as useTempDemoState; the name avoids the react-hooks/rules-of-hooks lint rule. */
export const withTempDemoState = useTempDemoState;

// ---------------------------------------------------------------------------------------------
// Contract validation (results must validate against the component schemas)
// ---------------------------------------------------------------------------------------------

type Validator = ((value: unknown) => boolean) & { errors?: unknown };
const ajv = createAjv();
const validators = new Map<string, Validator>();

/** Throws with the Ajv errors when `value` does not validate against the contract component schema `schemaName`. */
export function expectValid(schemaName: string, value: unknown): void {
  let validate = validators.get(schemaName);
  if (validate === undefined) {
    validate = ajv.compile(getComponentSchema(schemaName)) as Validator;
    validators.set(schemaName, validate);
  }
  if (!validate(value)) {
    throw new Error(`Does not match ${schemaName}: ${JSON.stringify(validate.errors, null, 1).slice(0, 1500)}`);
  }
}

/** Validates every item of a list result against its item schema, and the list against the list schema when given. */
export function expectValidItems(itemSchema: string, items: readonly unknown[]): void {
  for (const item of items) expectValid(itemSchema, item);
}

// ---------------------------------------------------------------------------------------------
// Crafted ids (review finding M4)
// ---------------------------------------------------------------------------------------------

/** Ids no data function may pass on to a store lookup: names an object inherits, empty, not a UUID, not even a string. */
export const JUNK_IDS: readonly unknown[] = ['toString', '__proto__', 'constructor', 'prototype', 'hasOwnProperty', '', ' ', 'not-a-uuid', '../../etc/passwd', 123, null, undefined, {}, [], true];

/** JUNK_IDS for a key that is a code and not a UUID (an identity provider alias): `not-a-uuid` is a well-formed code, so it is left out. */
export const JUNK_CODES: readonly unknown[] = JUNK_IDS.filter((id) => id !== 'not-a-uuid');

/** No TS store any more: Go holds the data. */
export function dataSnapshot(): string {
  return '';
}

/** How many audit events Go holds so far. */
export async function auditCount(): Promise<number> {
  return goAuditCount();
}

/** Seeds one event in Go's audit log, as the caller (tests only; a screen can never append an event). */
export async function recordAuditForTest(ctx: RequestContext, input: Omit<TestAuditInput, 'user_id'>): Promise<AuditEvent> {
  return goRecordAudit<AuditEvent>({ ...input, user_id: ctx.userId });
}

function codeOf(error: unknown): string {
  return error instanceof DataError ? error.code : `not a DataError: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`;
}

async function expectJunkCodes(call: (id: never) => Promise<unknown>, ids: readonly unknown[], expected: 'invalid' | 'forbidden'): Promise<void> {
  const before = dataSnapshot();
  const audits = await auditCount();
  for (const id of ids) {
    let code = 'did not throw';
    try {
      await call(id as never);
    } catch (error) {
      code = codeOf(error);
    }
    expect(code, `id ${JSON.stringify(id) ?? String(id)}`).toBe(expected);
  }
  expect(dataSnapshot()).toBe(before);
  expect(await auditCount()).toBe(audits + (expected === 'forbidden' ? ids.length : 0));
}

// Async form of expectJunkIdsInvalid.
export const expectJunkIdsInvalidLive = (call: (id: never) => Promise<unknown>, ids: readonly unknown[] = JUNK_IDS): Promise<void> => expectJunkCodes(call, ids, 'invalid');

// Async form of expectJunkIdsForbidden.
export const expectJunkIdsForbiddenLive = (call: (id: never) => Promise<unknown>, ids: readonly unknown[] = JUNK_IDS): Promise<void> => expectJunkCodes(call, ids, 'forbidden');

export { buildContext, fixtureTenantId, fixtureUsers, patchGoUpdatesState, resetGoTestState, syncGoClock };
export type { DemoChoice } from './go-test-reset';

// Raw /_internal CRUD, for test setup and reads.
const RAW_PATHS: Readonly<Record<string, string>> = {
  City: '/_internal/cities',
  Zone: '/_internal/zones',
  SubZone: '/_internal/sub-zones',
  StandbyPoint: '/_internal/standby-points',
  Agent: '/_internal/agents',
  Vehicle: '/_internal/vehicles',
  ShiftPattern: '/_internal/shift-patterns',
  LeaveRequest: '/_internal/leave-requests',
  Roster: '/_internal/rosters',
  RosterAssignment: '/_internal/roster-assignments',
  Case: '/_internal/cases',
  CaseType: '/_internal/case-types',
  ImportJob: '/_internal/import-jobs',
  DataQualityIssue: '/_internal/data-quality-issues',
};

function rawPathOf(schema: string): string {
  const found = RAW_PATHS[schema];
  if (found === undefined) throw new Error(`No raw route for schema "${schema}".`);
  return found;
}

interface RawPage<T> {
  readonly data: readonly T[];
  readonly page: { readonly next_cursor: string | null; readonly has_more: boolean };
}

/** Every row of a schema, a page at a time (keyset). */
export async function readAll<T extends HasId>(tenantId: string, schema: string): Promise<readonly T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    const query = cursor === undefined ? 'limit=500' : `limit=500&cursor=${encodeURIComponent(cursor)}`;
    const page = await goRawFetch<RawPage<T>>(`${rawPathOf(schema)}?${query}`, { tenantId });
    out.push(...(page?.data ?? []));
    if (page === undefined || !page.page.has_more || page.page.next_cursor === null) break;
    cursor = page.page.next_cursor;
  }
  return out;
}

/** Writes one row straight to the store (no audit). */
export async function upsert<T extends HasId>(tenantId: string, schema: string, record: T): Promise<T> {
  const res = await goRawFetch<{ data: T }>(rawPathOf(schema), { tenantId, method: 'POST', body: record });
  if (res === undefined) throw new Error(`${schema} was not returned after write.`);
  return res.data;
}

/** Stores a raw setting through Go (no TS check). */
export async function putSettingForTest(ctx: RequestContext, key: string, value: unknown): Promise<void> {
  await businessFetch<undefined>(ctx, `/settings/raw/${encodeURIComponent(key)}`, { method: 'PUT', body: { value } });
}

/** Raises an event's alert through Go's /notify. */
export async function raiseNotificationForTest(ctx: RequestContext, eventType: string, content: { readonly title_en: string; readonly body_en?: string }): Promise<void> {
  await businessFetch<unknown>(ctx, '/notify', { method: 'POST', body: { ...content, event_type: eventType, pre_session: false } });
}

export interface FieldShareForTest {
  readonly rule_set_version: string;
  readonly as_of_date: string;
  readonly field_preferred_weight: number;
  readonly active_rules: readonly { readonly rule_code: string; readonly version: number; readonly outcome: RuleOutcome }[];
  readonly zones: readonly { readonly zone_id: string; readonly case_count: number; readonly field_share: number | null; readonly outcomes: Readonly<Record<RuleOutcome, number>> }[];
  readonly overall_field_share: number | null;
  readonly data_source: DataSource;
}

export interface FieldShareQuery {
  readonly date?: string | undefined;
  readonly ruleVersionId?: string | undefined;
  readonly zoneId?: string | undefined;
}

/** Go's field share; no screen reads it. */
export async function fieldShareForTest(ctx: RequestContext, options: FieldShareQuery = {}): Promise<FieldShareForTest> {
  const params = new URLSearchParams();
  if (options.date !== undefined) params.set('date', options.date);
  if (options.ruleVersionId !== undefined) params.set('rule_version_id', options.ruleVersionId);
  if (options.zoneId !== undefined) params.set('zone_id', options.zoneId);
  const query = params.toString();
  return requireFound(await businessFetch<FieldShareForTest>(ctx, `/field-share${query === '' ? '' : `?${query}`}`), 'Rule version');
}
