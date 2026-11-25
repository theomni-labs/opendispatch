// SPDX-License-Identifier: AGPL-3.0-only
// Classification rules: thin Go client.

import type { ClassificationRule, ClassificationRuleList, RuleVersion, RuleVersionList } from '@/lib/types';
import { requireFound, type PageQuery } from './context';
import type { RequestContext } from './guard';
import { businessFetch } from './internal/business-client';
import { pathSegment } from './internal/path-segment';

function qs(params: Readonly<Record<string, string | number | undefined>>): string {
  const parts = Object.entries(params).filter(([, val]) => val !== undefined && val !== '');
  return parts.length === 0 ? '' : `?${parts.map(([k, val]) => `${k}=${encodeURIComponent(String(val))}`).join('&')}`;
}

/** @pure A version for Go: a number, or `-`. */
function versionSegment(version: unknown): string {
  return typeof version === 'number' ? pathSegment(version) : '-';
}

// operationId: listRules
export async function listRules(ctx: RequestContext, query: PageQuery & { readonly status?: ClassificationRule['status'] | undefined } = {}): Promise<ClassificationRuleList> {
  return (await businessFetch<ClassificationRuleList>(ctx, `/rules${qs({ limit: query.limit, cursor: query.cursor, status: query.status })}`))!;
}

// operationId: getRule
export async function getRule(ctx: RequestContext, ruleCode: string): Promise<ClassificationRule> {
  return requireFound(await businessFetch<ClassificationRule>(ctx, `/rules/${pathSegment(ruleCode)}`), `Rule ${ruleCode}`);
}

// operationId: listRuleVersions
export async function listRuleVersions(ctx: RequestContext, ruleCode: string, query: PageQuery = {}): Promise<RuleVersionList> {
  return requireFound(await businessFetch<RuleVersionList>(ctx, `/rules/${pathSegment(ruleCode)}/versions${qs({ limit: query.limit, cursor: query.cursor })}`), `Rule ${ruleCode}`);
}

// operationId: createRule
export async function createRule(ctx: RequestContext, body: unknown): Promise<ClassificationRule> {
  const rule = (await businessFetch<ClassificationRule>(ctx, '/rules', { method: 'POST', body }))!;
  return rule;
}

// operationId: createRuleVersionDraft
export async function createRuleVersionDraft(ctx: RequestContext, ruleCode: string, body: unknown): Promise<RuleVersion> {
  const version = (await businessFetch<RuleVersion>(ctx, `/rules/${pathSegment(ruleCode)}/versions`, { method: 'POST', body }))!;
  return version;
}

// operationId: updateRuleVersionDraft
export async function updateRuleVersionDraft(ctx: RequestContext, ruleCode: string, version: number, body: unknown): Promise<RuleVersion> {
  const updated = (await businessFetch<RuleVersion>(ctx, `/rules/${pathSegment(ruleCode)}/versions/${versionSegment(version)}`, { method: 'PUT', body }))!;
  return updated;
}

// operationId: submitRuleVersion
export async function submitRuleVersion(ctx: RequestContext, ruleCode: string, version: number): Promise<RuleVersion> {
  const submitted = (await businessFetch<RuleVersion>(ctx, `/rules/${pathSegment(ruleCode)}/versions/${versionSegment(version)}/submit`, { method: 'POST', body: {} }))!;
  return submitted;
}

/** Approve or reject: Go checks who may decide. */
// operationId: approveRuleVersion
export async function approveRuleVersion(ctx: RequestContext, ruleCode: string, version: number, body: unknown = {}): Promise<RuleVersion> {
  const approved = (await businessFetch<RuleVersion>(ctx, `/rules/${pathSegment(ruleCode)}/versions/${versionSegment(version)}/approve`, { method: 'POST', body }))!;
  return approved;
}

// operationId: rejectRuleVersion
export async function rejectRuleVersion(ctx: RequestContext, ruleCode: string, version: number, body: unknown = {}): Promise<RuleVersion> {
  const rejected = (await businessFetch<RuleVersion>(ctx, `/rules/${pathSegment(ruleCode)}/versions/${versionSegment(version)}/reject`, { method: 'POST', body }))!;
  return rejected;
}

// operationId: retireRule
export async function retireRule(ctx: RequestContext, ruleCode: string, body: unknown = {}): Promise<ClassificationRule> {
  const rule = (await businessFetch<ClassificationRule>(ctx, `/rules/${pathSegment(ruleCode)}/retire`, { method: 'POST', body }))!;
  return rule;
}
