// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { Setting } from '@/lib/types';
import { getAuditEvent, listAuditEvents } from './audit';
import { getCase } from './cases';
import { getCaseRecommendation, getAssignment, listAssignmentEvents, listAgentPositions, acceptRecommendation, overrideAssignment } from './dispatch';
import { ForbiddenError } from './errors';
import {
  deleteIdentityProvider,
  deleteRoleMapping,
  getIdentityProvider,
  testIdentityProviderConnection,
  updateIdentityProvider,
  updateRoleMapping,
} from './identity';
import { compareImport, dryRunCutover, executeCutover, getImportJob, listImportIssues, updateDataQualityIssue, validateImport } from './imports';
import { DataError } from './errors';
import { fixtureRecords } from './internal/fixtures';
import { createCity, deleteStandbyPoint, getCity, getSubZone, getZone, listCities, updateCity, updateStandbyPoint, updateSubZone, updateZone } from './locations';
import { switchModelVersion } from './models';
import { markNotificationRead, sendTestNotification, updateNotificationRule } from './notifications';
import { getAgent, getVehicle, listAgentSkills, setAgentSkills, updateAgent, updateVehicle } from './people';
import { setZoneStage } from './settings';
import {
  deleteWebhook,
  downloadDiagnosticsBundle,
  getIntegration,
  getWebhook,
  listWebhookDeliveries,
  revokeApiClient,
  rotateApiClient,
  testIntegration,
  testWebhook,
  updateControlEvidence,
  updateIntegration,
  updateWebhook,
} from './system';
import { deleteHoliday, getShiftPattern, updateBreakRule, updateHoliday, updateShiftPattern } from './time';
import { disableUser, enableUser, getEffectiveAccess, getUser, resetEmergencyAdminMfa, resetEmergencyAdminPassword, updateUser } from './users';
import { auditCount, ctxFor, dataSnapshot, JUNK_CODES, JUNK_IDS, withTempDemoState } from './test-support';

// Review finding M4 (and m2, m10) for the modules that take an entity id from the caller: a crafted id (`toString`,
// `__proto__`, an empty string, a number, null ...) is refused with `invalid` after the role check and before any store
// lookup, changes nothing, and a caller who may not write gets `forbidden` (audited) whatever the id is.
//
// The update/delete functions of the plan modules (rosters, leave, scenarios ...) and of Updates have the same block in
// their own test files.

withTempDemoState();

const admin = () => ctxFor('administrator');
const viewer = () => ctxFor('viewer_auditor');
const supervisor = () => ctxFor('dispatch_supervisor');
const BODY = {};

function codeOfError(error: unknown): string {
  return error instanceof DataError ? error.code : `not a DataError: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`;
}

// Async form: locations calls are now api-backed.
async function expectJunkIdsInvalidLive(call: (id: never) => Promise<unknown>, ids: readonly unknown[] = JUNK_IDS): Promise<void> {
  const before = dataSnapshot();
  const audits = await auditCount();
  for (const id of ids) {
    let code = 'did not throw';
    try {
      await call(id as never);
    } catch (error) {
      code = codeOfError(error);
    }
    expect(code, `id ${JSON.stringify(id) ?? String(id)}`).toBe('invalid');
  }
  expect(dataSnapshot()).toBe(before);
  expect(await auditCount()).toBe(audits);
}

// Async form: locations calls are now api-backed.
async function expectJunkIdsForbiddenLive(call: (id: never) => Promise<unknown>, ids: readonly unknown[] = JUNK_IDS): Promise<void> {
  const before = dataSnapshot();
  const audits = await auditCount();
  for (const id of ids) {
    let code = 'did not throw';
    try {
      await call(id as never);
    } catch (error) {
      code = codeOfError(error);
    }
    expect(code, `id ${JSON.stringify(id) ?? String(id)}`).toBe('forbidden');
  }
  expect(dataSnapshot()).toBe(before);
  expect(await auditCount()).toBe(audits + ids.length);
}

describe('crafted ids: an Administrator gets invalid and nothing changes', () => {
  it('locations, people, users and notifications', async () => {
    const ctx = admin();
    await expectJunkIdsInvalidLive((id) => getCity(ctx, id));
    await expectJunkIdsInvalidLive((id) => getZone(ctx, id));
    await expectJunkIdsInvalidLive((id) => getSubZone(ctx, id));
    await expectJunkIdsInvalidLive((id) => updateCity(ctx, id, BODY));
    await expectJunkIdsInvalidLive((id) => updateZone(ctx, id, BODY));
    await expectJunkIdsInvalidLive((id) => updateSubZone(ctx, id, BODY));
    await expectJunkIdsInvalidLive((id) => updateStandbyPoint(ctx, id, BODY));
    await expectJunkIdsInvalidLive((id) => deleteStandbyPoint(ctx, id));
    await expectJunkIdsInvalidLive((id) => getAgent(ctx, id));
    await expectJunkIdsInvalidLive((id) => getVehicle(ctx, id));
    await expectJunkIdsInvalidLive((id) => listAgentSkills(ctx, id));
    await expectJunkIdsInvalidLive((id) => updateAgent(ctx, id, BODY));
    await expectJunkIdsInvalidLive((id) => setAgentSkills(ctx, id, BODY));
    await expectJunkIdsInvalidLive((id) => updateVehicle(ctx, id, BODY));
    await expectJunkIdsInvalidLive((id) => getUser(ctx, id));
    await expectJunkIdsInvalidLive((id) => getEffectiveAccess(ctx, id));
    await expectJunkIdsInvalidLive((id) => updateUser(ctx, id, BODY));
    await expectJunkIdsInvalidLive((id) => disableUser(ctx, id));
    await expectJunkIdsInvalidLive((id) => enableUser(ctx, id));
    await expectJunkIdsInvalidLive((id) => resetEmergencyAdminPassword(ctx, id));
    await expectJunkIdsInvalidLive((id) => resetEmergencyAdminMfa(ctx, id));
    await expectJunkIdsInvalidLive((id) => markNotificationRead(ctx, id));
    await expectJunkIdsInvalidLive((id) => updateNotificationRule(ctx, id, BODY));
    await expectJunkIdsInvalidLive((id) => sendTestNotification(ctx, id));
  });

  it('time, imports, identity, system, models, settings, audit and cases', async () => {
    const ctx = admin();
    await expectJunkIdsInvalidLive((id) => getShiftPattern(ctx, id));
    await expectJunkIdsInvalidLive((id) => updateShiftPattern(ctx, id, BODY));
    await expectJunkIdsInvalidLive((id) => updateBreakRule(ctx, id, BODY));
    await expectJunkIdsInvalidLive((id) => updateHoliday(ctx, id, BODY));
    await expectJunkIdsInvalidLive((id) => deleteHoliday(ctx, id));
    await expectJunkIdsInvalidLive((id) => getImportJob(ctx, id));
    await expectJunkIdsInvalidLive((id) => listImportIssues(ctx, id));
    await expectJunkIdsInvalidLive((id) => updateDataQualityIssue(ctx, id, BODY));
    await expectJunkIdsInvalidLive((id) => validateImport(ctx, id));
    await expectJunkIdsInvalidLive((id) => compareImport(ctx, id));
    await expectJunkIdsInvalidLive((id) => dryRunCutover(ctx, id));
    await expectJunkIdsInvalidLive((id) => executeCutover(ctx, id));
    await expectJunkIdsInvalidLive((id) => getIdentityProvider(ctx, id), JUNK_CODES); // a provider id is a Keycloak alias, not a UUID
    await expectJunkIdsInvalidLive((id) => updateIdentityProvider(ctx, id, BODY), JUNK_CODES); // a provider id is a Keycloak alias, not a UUID
    await expectJunkIdsInvalidLive((id) => deleteIdentityProvider(ctx, id), JUNK_CODES); // a provider id is a Keycloak alias, not a UUID
    await expectJunkIdsInvalidLive((id) => testIdentityProviderConnection(ctx, id), JUNK_CODES); // a provider id is a Keycloak alias, not a UUID
    await expectJunkIdsInvalidLive((id) => updateRoleMapping(ctx, id, BODY));
    await expectJunkIdsInvalidLive((id) => deleteRoleMapping(ctx, id));
    await expectJunkIdsInvalidLive((id) => updateControlEvidence(ctx, id, BODY));
    await expectJunkIdsInvalidLive((id) => revokeApiClient(ctx, id));
    await expectJunkIdsInvalidLive((id) => rotateApiClient(ctx, id));
    await expectJunkIdsInvalidLive((id) => getWebhook(ctx, id));
    await expectJunkIdsInvalidLive((id) => updateWebhook(ctx, id, BODY));
    await expectJunkIdsInvalidLive((id) => deleteWebhook(ctx, id));
    await expectJunkIdsInvalidLive((id) => listWebhookDeliveries(ctx, id));
    await expectJunkIdsInvalidLive((id) => testWebhook(ctx, id));
    await expectJunkIdsInvalidLive((id) => getIntegration(ctx, id));
    await expectJunkIdsInvalidLive((id) => updateIntegration(ctx, id, BODY));
    await expectJunkIdsInvalidLive((id) => testIntegration(ctx, id));
    await expectJunkIdsInvalidLive((id) => downloadDiagnosticsBundle(ctx, id));
    await expectJunkIdsInvalidLive((id) => switchModelVersion(ctx, id, BODY));
    await expectJunkIdsInvalidLive((id) => setZoneStage(ctx, id, BODY));
    await expectJunkIdsInvalidLive((id) => getAuditEvent(ctx, id));
    await expectJunkIdsInvalidLive((id) => getCase(ctx, id));
  });

  it('the live dispatch board (a Dispatch Supervisor)', async () => {
    const ctx = supervisor();
    await expectJunkIdsInvalidLive((id) => getCaseRecommendation(ctx, id));
    await expectJunkIdsInvalidLive((id) => getAssignment(ctx, id));
    await expectJunkIdsInvalidLive((id) => listAssignmentEvents(ctx, id));
    await expectJunkIdsInvalidLive((id) => listAgentPositions(ctx, id));
    await expectJunkIdsInvalidLive((id) => acceptRecommendation(ctx, id, BODY));
    await expectJunkIdsInvalidLive((id) => overrideAssignment(ctx, id, BODY));
  });
});

describe('crafted ids: a caller who may not write gets forbidden, audited, never invalid (m2) and never a TypeError (m10)', () => {
  it('every write of these modules', async () => {
    const ctx = viewer();
    await expectJunkIdsForbiddenLive((id) => updateCity(ctx, id, BODY));
    await expectJunkIdsForbiddenLive((id) => updateZone(ctx, id, BODY));
    await expectJunkIdsForbiddenLive((id) => updateSubZone(ctx, id, BODY));
    await expectJunkIdsForbiddenLive((id) => updateStandbyPoint(ctx, id, BODY));
    await expectJunkIdsForbiddenLive((id) => deleteStandbyPoint(ctx, id));
    await expectJunkIdsForbiddenLive((id) => updateAgent(ctx, id, BODY));
    await expectJunkIdsForbiddenLive((id) => setAgentSkills(ctx, id, BODY));
    await expectJunkIdsForbiddenLive((id) => updateVehicle(ctx, id, BODY));
    await expectJunkIdsForbiddenLive((id) => updateUser(ctx, id, BODY));
    await expectJunkIdsForbiddenLive((id) => disableUser(ctx, id));
    await expectJunkIdsForbiddenLive((id) => enableUser(ctx, id));
    await expectJunkIdsForbiddenLive((id) => resetEmergencyAdminPassword(ctx, id));
    await expectJunkIdsForbiddenLive((id) => resetEmergencyAdminMfa(ctx, id));
    await expectJunkIdsForbiddenLive((id) => updateNotificationRule(ctx, id, BODY));
    await expectJunkIdsForbiddenLive((id) => sendTestNotification(ctx, id));
    await expectJunkIdsForbiddenLive((id) => updateShiftPattern(ctx, id, BODY));
    await expectJunkIdsForbiddenLive((id) => updateBreakRule(ctx, id, BODY));
    await expectJunkIdsForbiddenLive((id) => updateHoliday(ctx, id, BODY));
    await expectJunkIdsForbiddenLive((id) => deleteHoliday(ctx, id));
    await expectJunkIdsForbiddenLive((id) => updateDataQualityIssue(ctx, id, BODY));
    await expectJunkIdsForbiddenLive((id) => validateImport(ctx, id));
    await expectJunkIdsForbiddenLive((id) => compareImport(ctx, id));
    await expectJunkIdsForbiddenLive((id) => dryRunCutover(ctx, id));
    await expectJunkIdsForbiddenLive((id) => executeCutover(ctx, id));
    await expectJunkIdsForbiddenLive((id) => updateIdentityProvider(ctx, id, BODY));
    await expectJunkIdsForbiddenLive((id) => deleteIdentityProvider(ctx, id));
    await expectJunkIdsForbiddenLive((id) => testIdentityProviderConnection(ctx, id));
    await expectJunkIdsForbiddenLive((id) => updateRoleMapping(ctx, id, BODY));
    await expectJunkIdsForbiddenLive((id) => deleteRoleMapping(ctx, id));
    await expectJunkIdsForbiddenLive((id) => updateControlEvidence(ctx, id, BODY));
    await expectJunkIdsForbiddenLive((id) => revokeApiClient(ctx, id));
    await expectJunkIdsForbiddenLive((id) => rotateApiClient(ctx, id));
    await expectJunkIdsForbiddenLive((id) => updateWebhook(ctx, id, BODY));
    await expectJunkIdsForbiddenLive((id) => deleteWebhook(ctx, id));
    await expectJunkIdsForbiddenLive((id) => testWebhook(ctx, id));
    await expectJunkIdsForbiddenLive((id) => updateIntegration(ctx, id, BODY));
    await expectJunkIdsForbiddenLive((id) => testIntegration(ctx, id));
    await expectJunkIdsForbiddenLive((id) => switchModelVersion(ctx, id, BODY));
    await expectJunkIdsForbiddenLive((id) => setZoneStage(ctx, id, BODY));
    await expectJunkIdsForbiddenLive((id) => acceptRecommendation(ctx, id, BODY));
    await expectJunkIdsForbiddenLive((id) => overrideAssignment(ctx, id, BODY));
  });

  it('a denied call names a text id in the audit event and never throws on an odd one', async () => {
    const ctx = viewer();
    for (const id of [123, {}, [], Object.create(null), Symbol('id'), 10n, 'toString'] as unknown[]) {
      await expect(updateCity(ctx, id as never, BODY)).rejects.toThrow(ForbiddenError);
    }
    const denied = (await listAuditEvents(admin(), { action: 'location.city_updated', outcome: 'denied', limit: 50 })).items;
    expect(denied).toHaveLength(7);
    for (const event of denied) expect(event.entity_id === null || typeof event.entity_id === 'string').toBe(true);
    expect(denied.map((e) => e.entity_id)).toEqual(expect.arrayContaining(['123', 'toString', '10']));
  });
});

describe('crafted ids cannot create a record', () => {
  it('after a create, an update of `toString` leaves no record without an id or tenant', async () => {
    const ctx = admin();
    // Random: city data lives in Postgres now.
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code: string;
    do {
      code = `${letters[Math.floor(Math.random() * 26)]}${letters[Math.floor(Math.random() * 26)]}`;
    } while (['RD', 'JD', 'DM'].includes(code));
    await createCity(ctx, { case_code: code, name_en: 'Makkah', name_ar: null });
    for (const id of ['toString', '__proto__', 'constructor']) {
      await expect(updateCity(ctx, id, { case_code: 'ZZ', name_en: 'Bogus', name_ar: null })).rejects.toThrow(/UUID/);
    }
    const cities = (await listCities(ctx, { q: code })).items;
    expect(cities.map((c) => c.case_code)).toContain(code);
    for (const city of cities) {
      expect(typeof city.id).toBe('string');
      expect(typeof city.tenant_id).toBe('string');
      expect(city.data_source).toBe('SYNTHETIC');
      expect(typeof city.created_at).toBe('string');
    }
    expect(cities.some((c) => c.name_en === 'Bogus')).toBe(false);
  });

  it('real ids still work: every fixture record can be read by its id', async () => {
    const ctx = admin();
    const city = fixtureRecords<{ id: string }>('City')[0]!;
    expect((await getCity(ctx, city.id)).id).toBe(city.id);
    const setting = fixtureRecords<Setting>('Setting')[0]!;
    expect(setting.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
