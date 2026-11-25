'use server';
// SPDX-License-Identifier: AGPL-3.0-only

// The writes of the Agents and Vehicles screen: exactly the data functions of lib/data/people.ts.
//
//   saveAgent           createAgent / updateAgent, then setAgentSkills when the skills changed
//   setAgentsInactive   updateAgent once per agent   (the bulk bar: N calls)
//   saveVehicle            createVehicle / updateVehicle
//   addSkillToVocabulary   addSkill
//   renameSkill            updateSkill   (the Arabic name)
//   removeSkillFromVocabulary  removeSkill   (refused while held)
//   importAgentsCsv     importAgents   (the browser reads the file and sends its text; all or nothing)
//
// Rule 2: no action takes a context, customer, user, role, zone scope or install mode from the browser. Each builds its own
// context with requireRequestContext() inside runAction, and the data function authorises, validates and audits. An update starts
// from the record as stored, because the data layer's bodies are complete: a body with no `extra` would blank the shift, the days
// off and the standby point. The screen sends only what a person typed.
// (tools/rules/context-rules.test.ts scans this file for the forbidden names.)

import { pickFields, pickText, pickTextList } from '@/lib/actions/pick';
import { runAction } from '@/lib/actions/run-action';
import type { ActionResult } from '@/lib/actions/types';
import { DataError, ForbiddenError, InvalidInputError, NotFoundError } from '@/lib/data/errors';
import { addSkill, createAgent, createVehicle, getAgent, getVehicle, importAgents, listAgentSkills, removeSkill, setAgentSkills, updateSkill, updateAgent, updateVehicle } from '@/lib/data/people';
import type { Extra, Agent } from '@/lib/types';
import { DAYS, VEHICLE_TYPES, type AddSkillInput, type DeactivateResult, type ImportSummary, type ImportAgentsInput, type RenameSkillInput, type SaveAgentInput, type SaveVehicleInput, type SavedSummary, type SkillSummary, type SkillTarget, type AgentTargets } from './types';

const REVALIDATE = '/admin/agents-vehicles';
const MAX_BULK = 100;

type Fields = Readonly<Record<string, unknown>>;

const textOf = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const nullIfEmpty = (value: string): string | null => (value === '' ? null : value);

/** The record a change starts from; `undefined` when the caller may not read it or it does not exist (the write then answers). */
async function stored<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof NotFoundError) return undefined;
    throw error;
  }
}

/** The same `extra`, with the keys the person edits set (or removed when empty). */
function withExtra(base: Extra | undefined, changes: Readonly<Record<string, unknown>>): Extra {
  const out: Record<string, unknown> = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) delete out[key];
    else out[key] = value;
  }
  return out;
}

function agentBody(existing: Agent | undefined, fields: Fields): Record<string, unknown> {
  const days = pickTextList(fields, 'days_off', 7) ?? [];
  if (!days.every((day) => (DAYS as readonly string[]).includes(day))) throw new InvalidInputError(`Days off: each is one of ${DAYS.join(', ')}.`);
  const zoneId = textOf(fields['zone_id']);
  return {
    code: existing?.code ?? textOf(fields['code']),
    name_en: textOf(fields['name_en']),
    name_ar: existing?.name_ar ?? null,
    kind: zoneId === '' ? 'remote' : 'field',
    home_zone_id: nullIfEmpty(zoneId),
    default_vehicle_id: nullIfEmpty(textOf(fields['vehicle_id'])),
    is_active: fields['is_active'] === true,
    ...eligibilityBody(existing, fields),
    extra: withExtra(existing?.extra, { home_shift: textOf(fields['shift_code']), days_off: [...new Set(days)], standby_point_id: textOf(fields['standby_point_id']) }),
  };
}

/** Eligible shifts and annual leave days, when the form sent them; else as stored. */
function eligibilityBody(existing: Agent | undefined, fields: Fields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (fields['eligible_shift_ids'] !== undefined) {
    const ids = pickTextList(fields, 'eligible_shift_ids', 50);
    if (ids === undefined) throw new InvalidInputError('Eligible shifts: a list of shift pattern ids.');
    out['eligible_shift_pattern_ids'] = ids.length === 0 ? null : [...new Set(ids)];
  } else if (existing !== undefined) {
    out['eligible_shift_pattern_ids'] = existing.eligible_shift_pattern_ids ?? null;
  }
  if (fields['annual_leave_days'] !== undefined) {
    const raw = textOf(fields['annual_leave_days']);
    const days = Number(raw);
    if (raw !== '' && (!/^\d{1,3}$/.test(raw) || days > 365)) throw new InvalidInputError('Annual leave days: a whole number from 0 to 365.');
    out['annual_leave_days'] = raw === '' ? null : days;
  } else if (existing !== undefined) {
    out['annual_leave_days'] = existing.annual_leave_days ?? null;
  }
  return out;
}

/** The stored agent, set inactive. */
function inactiveBody(current: Agent): Record<string, unknown> {
  const extra = current.extra ?? {};
  return agentBody(current, { name_en: current.name_en, zone_id: current.home_zone_id ?? '', vehicle_id: current.default_vehicle_id ?? '', days_off: extra['days_off'] ?? [], shift_code: extra['home_shift'] ?? '', standby_point_id: extra['standby_point_id'] ?? '', is_active: false });
}

const KEYS = ['targetId', 'name_en', 'code', 'zone_id', 'shift_code', 'vehicle_id', 'standby_point_id', 'days_off', 'skill_codes', 'eligible_shift_ids', 'annual_leave_days', 'is_active'] as const;

/** Adds or changes an agent, and sets the skills when they differ from what the agent has. */
export async function saveAgent(input: SaveAgentInput): Promise<ActionResult<SavedSummary>> {
  return runAction(
    async (ctx) => {
      const fields = pickFields(input, KEYS);
      const targetId = typeof fields.targetId === 'string' && fields.targetId !== '' ? fields.targetId : undefined;
      const skills = pickTextList(fields, 'skill_codes', 20);
      if (skills === undefined) throw new InvalidInputError('Skills: a list of skill codes.');
      const wanted = [...new Set(skills)];
      if (targetId === undefined) {
        const created = await createAgent(ctx, agentBody(undefined, fields));
        if (wanted.length > 0) await setAgentSkills(ctx, created.id, { skill_codes: wanted });
        return { id: created.id, name: created.name_en, created: true } satisfies SavedSummary;
      }
      const current = await stored(() => getAgent(ctx, targetId));
      const updated = await updateAgent(ctx, targetId, agentBody(current, fields));
      const had = new Set((await listAgentSkills(ctx, targetId, { limit: 200 })).items.map((k) => k.skill_code));
      if (had.size !== wanted.length || wanted.some((code) => !had.has(code))) await setAgentSkills(ctx, targetId, { skill_codes: wanted });
      return { id: updated.id, name: updated.name_en, created: false } satisfies SavedSummary;
    },
    { revalidate: REVALIDATE },
  );
}

/**
 * Sets each agent named inactive, one data call each (each audited). A refusal for one (not found) is counted and the rest go
 * on; a refusal that concerns the caller (no session, no permission) stops at the first, so a viewer leaves one `denied` event.
 */
export async function setAgentsInactive(input: AgentTargets): Promise<ActionResult<DeactivateResult>> {
  return runAction(
    async (ctx) => {
      const ids = pickTextList(input, 'targetIds', MAX_BULK);
      if (ids === undefined || ids.length === 0) throw new InvalidInputError(`Agents: name 1 to ${MAX_BULK}.`);
      let changed = 0;
      let failed = 0;
      let firstProblem: string | undefined;
      for (const id of [...new Set(ids)]) {
        try {
          const current = await stored(() => getAgent(ctx, id));
          if (current?.is_active === false) continue;
          await updateAgent(ctx, id, current === undefined ? { is_active: false } : inactiveBody(current));
          changed += 1;
        } catch (error) {
          if (!(error instanceof DataError) || error.code === 'forbidden' || error.code === 'unauthenticated') throw error;
          failed += 1;
          firstProblem ??= error.message;
        }
      }
      return { changed, failed, ...(firstProblem === undefined ? {} : { firstProblem }) } satisfies DeactivateResult;
    },
    { revalidate: REVALIDATE },
  );
}

/** Adds or changes a vehicle: code (an add only), plate, type (kept in `extra`), zone and whether it is in service. */
export async function saveVehicle(input: SaveVehicleInput): Promise<ActionResult<SavedSummary>> {
  return runAction(
    async (ctx) => {
      const fields = pickFields(input, ['targetId', 'code', 'plate_number', 'vehicle_type', 'zone_id', 'is_active']);
      const targetId = typeof fields.targetId === 'string' && fields.targetId !== '' ? fields.targetId : undefined;
      const type = textOf(fields['vehicle_type']);
      if (type !== '' && !(VEHICLE_TYPES as readonly string[]).includes(type)) throw new InvalidInputError(`Type: one of ${VEHICLE_TYPES.join(', ')}.`);
      const write = { plate_number: textOf(fields['plate_number']), zone_id: fields['zone_id'], is_active: fields['is_active'] === true };
      if (targetId === undefined) {
        const created = await createVehicle(ctx, { ...write, code: textOf(fields['code']), extra: withExtra(undefined, { vehicle_type: type }) });
        return { id: created.id, name: created.code, created: true } satisfies SavedSummary;
      }
      const current = await stored(() => getVehicle(ctx, targetId));
      const updated = await updateVehicle(ctx, targetId, { ...write, code: current?.code ?? textOf(fields['code']), extra: withExtra(current?.extra, { vehicle_type: type }) });
      return { id: updated.id, name: updated.code, created: false } satisfies SavedSummary;
    },
    { revalidate: REVALIDATE },
  );
}

/** Adds a skill to the vocabulary the agent screens offer. */
export async function addSkillToVocabulary(input: AddSkillInput): Promise<ActionResult<SkillSummary>> {
  return runAction(
    async (ctx) => {
      const fields = pickFields(input, ['code', 'name_en', 'name_ar']);
      const skill = await addSkill(ctx, { code: textOf(fields['code']), name_en: textOf(fields['name_en']), name_ar: nullIfEmpty(textOf(fields['name_ar'])) });
      return { code: skill.code } satisfies SkillSummary;
    },
    { revalidate: REVALIDATE },
  );
}

/** Gives a skill its Arabic name; the code stays. */
export async function renameSkill(input: RenameSkillInput): Promise<ActionResult<SkillSummary>> {
  return runAction(
    async (ctx) => {
      const fields = pickFields(input, ['name_ar']);
      const skill = await updateSkill(ctx, pickText(input, 'code') ?? '', { name_ar: nullIfEmpty(textOf(fields['name_ar'])) });
      return { code: skill.code } satisfies SkillSummary;
    },
    { revalidate: REVALIDATE },
  );
}

/** Removes a skill no agent holds. */
export async function removeSkillFromVocabulary(input: SkillTarget): Promise<ActionResult<SkillSummary>> {
  return runAction(
    async (ctx) => {
      const code = pickText(input, 'code') ?? '';
      await removeSkill(ctx, code);
      return { code } satisfies SkillSummary;
    },
    { revalidate: REVALIDATE },
  );
}

/** Imports the CSV text the browser read. One audited call: every row is checked first, and nothing is written unless all are valid. */
export async function importAgentsCsv(input: ImportAgentsInput): Promise<ActionResult<ImportSummary>> {
  return runAction(
    async (ctx) => {
      const result = await importAgents(ctx, { file: pickText(input, 'file') });
      return { agents: result.agents, skills: result.skills } satisfies ImportSummary;
    },
    { revalidate: REVALIDATE },
  );
}
