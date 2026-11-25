// SPDX-License-Identifier: AGPL-3.0-only
// Agents, vehicles, skills: Go client.

import type { SkillVocabularyEntry, Agent, AgentImportResult, AgentList, AgentSkillList, Vehicle, VehicleList } from '@/lib/types';
import { requireFound, requirePlatform, type PageQuery } from './context';
import { requireAccess, type RequestContext } from './guard';
import { businessFetch } from './internal/business-client';
import { sampleText } from './internal/samples';
import { pathSegment } from './internal/path-segment';

function qs(params: Readonly<Record<string, string | number | undefined>>): string {
  const parts = Object.entries(params).filter(([, val]) => val !== undefined && val !== '');
  return parts.length === 0 ? '' : `?${parts.map(([k, val]) => `${k}=${encodeURIComponent(String(val))}`).join('&')}`;
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

// operationId: listAgents
export async function listAgents(
  ctx: RequestContext,
  query: PageQuery & { readonly zone_id?: string | undefined; readonly q?: string | undefined; readonly kind?: 'field' | 'remote' | undefined; readonly is_active?: boolean | undefined } = {},
): Promise<AgentList> {
  requirePlatform(ctx, 'platform.records');
  return (
    await businessFetch<AgentList>(
      ctx,
      `/agents${qs({ limit: query.limit, cursor: query.cursor, zone_id: query.zone_id, q: query.q, kind: query.kind, is_active: query.is_active === undefined ? undefined : String(query.is_active) })}`,
    )
  )!;
}

// operationId: getAgent
export async function getAgent(ctx: RequestContext, id: string): Promise<Agent> {
  requirePlatform(ctx, 'platform.records');
  return requireFound(await businessFetch<Agent>(ctx, `/agents/${pathSegment(id)}`), 'Agent');
}

// operationId: listAgentSkills
export async function listAgentSkills(ctx: RequestContext, agentId: string, query: PageQuery = {}): Promise<AgentSkillList> {
  requirePlatform(ctx, 'platform.records');
  return requireFound(await businessFetch<AgentSkillList>(ctx, `/agents/${pathSegment(agentId)}/skills${qs({ limit: query.limit, cursor: query.cursor })}`), 'Agent');
}

// operationId: listAllAgentSkills
export async function listAllAgentSkills(ctx: RequestContext, query: PageQuery & { readonly agent_ids?: readonly string[] | undefined } = {}): Promise<AgentSkillList> {
  requirePlatform(ctx, 'platform.records');
  // No ids asked: no skills, never every skill.
  if (query.agent_ids?.length === 0) return { items: [], page: { next_cursor: null, has_more: false, total: 0 } };
  return (await businessFetch<AgentSkillList>(ctx, `/agent-skills${qs({ limit: query.limit, cursor: query.cursor, agent_ids: query.agent_ids?.join(',') })}`))!;
}

// operationId: listVehicles
export async function listVehicles(ctx: RequestContext, query: PageQuery & { readonly zone_id?: string | undefined; readonly is_active?: boolean | undefined } = {}): Promise<VehicleList> {
  requirePlatform(ctx, 'platform.records');
  return (
    await businessFetch<VehicleList>(ctx, `/vehicles${qs({ limit: query.limit, cursor: query.cursor, zone_id: query.zone_id, is_active: query.is_active === undefined ? undefined : String(query.is_active) })}`)
  )!;
}

// operationId: getVehicle
export async function getVehicle(ctx: RequestContext, id: string): Promise<Vehicle> {
  requirePlatform(ctx, 'platform.records');
  return requireFound(await businessFetch<Vehicle>(ctx, `/vehicles/${pathSegment(id)}`), 'Vehicle');
}

// ---------------------------------------------------------------------------------------------
// Writes: Go checks and audits
// ---------------------------------------------------------------------------------------------

// operationId: createAgent
export async function createAgent(ctx: RequestContext, body: unknown): Promise<Agent> {
  return (await businessFetch<Agent>(ctx, '/agents', { method: 'POST', body }))!;
}

// operationId: updateAgent
export async function updateAgent(ctx: RequestContext, id: string, body: unknown): Promise<Agent> {
  return (await businessFetch<Agent>(ctx, `/agents/${pathSegment(id)}`, { method: 'PUT', body }))!;
}

/** Replaces the whole skill list of one agent. */
// operationId: setAgentSkills
export async function setAgentSkills(ctx: RequestContext, id: string, body: unknown): Promise<AgentSkillList> {
  return (await businessFetch<AgentSkillList>(ctx, `/agents/${pathSegment(id)}/skills`, { method: 'PUT', body }))!;
}

/**
 * Adds a skill to the vocabulary the agent screens offer (DG7; setting `skills.vocabulary`, read by getSkillVocabulary).
 * The code is unique without regard to case. Skill codes on an agent stay free strings (contract assumption 9).
 */
// operationId: addSkill
export async function addSkill(ctx: RequestContext, body: unknown): Promise<SkillVocabularyEntry> {
  return (await businessFetch<SkillVocabularyEntry>(ctx, '/skills', { method: 'POST', body }))!;
}

/** Renames a skill; its code, and so every agent holding it, stays. */
// operationId: updateSkill
export async function updateSkill(ctx: RequestContext, code: string, body: unknown): Promise<SkillVocabularyEntry> {
  return (await businessFetch<SkillVocabularyEntry>(ctx, `/skills/${pathSegment(code)}`, { method: 'PATCH', body }))!;
}

/** Removes a skill; refused (conflict) while an agent holds it. */
// operationId: removeSkill
export async function removeSkill(ctx: RequestContext, code: string): Promise<void> {
  await businessFetch<void>(ctx, `/skills/${pathSegment(code)}`, { method: 'DELETE' });
}

// operationId: createVehicle
export async function createVehicle(ctx: RequestContext, body: unknown): Promise<Vehicle> {
  return (await businessFetch<Vehicle>(ctx, '/vehicles', { method: 'POST', body }))!;
}

// operationId: updateVehicle
export async function updateVehicle(ctx: RequestContext, id: string, body: unknown): Promise<Vehicle> {
  return (await businessFetch<Vehicle>(ctx, `/vehicles/${pathSegment(id)}`, { method: 'PUT', body }))!;
}

// ---------------------------------------------------------------------------------------------
// Import from a CSV file (DG12): one audited call, now validated and written by Go.
// ---------------------------------------------------------------------------------------------

/** The sample file of the import dialog: invented, synthetic agents that import into a fresh demo (their zones, vehicles and skills exist in the fixtures). */
// operationId: (not in the contract) getAgentsImportSample
export function getAgentsImportSample(ctx: RequestContext): { readonly file_name: string; readonly content_type: 'text/csv'; readonly text: string } {
  requireAccess(ctx, 'admin.agents_vehicles', 'view');
  return { file_name: 'agents_sample.csv', content_type: 'text/csv', text: sampleText('agents_sample.csv') };
}

/**
 * Imports agents from a CSV file (DG12): the same shape as importLocations. The client sends the file text; the whole file is
 * checked first and nothing is written unless every row is valid. One audited event holds the counts (never names). Every record
 * is SYNTHETIC in demo mode. The shift, days off and standby point of an agent are not imported: edit them in the drawer.
 */
// operationId: importAgents
export async function importAgents(ctx: RequestContext, body: unknown): Promise<AgentImportResult> {
  return (await businessFetch<AgentImportResult>(ctx, '/agents/import', { method: 'POST', body }))!;
}
