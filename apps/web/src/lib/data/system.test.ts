// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Integration } from '@/lib/types';
import { listAuditEvents } from './audit';
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError } from './errors';
import { fixtureRecords } from './internal/fixtures';
import {
  confirmBackup,
  createApiClient,
  createDiagnosticsBundle,
  createWebhook,
  deleteWebhook,
  downloadDiagnosticsBundle,
  endSupportAccess,
  getBackupStatus,
  getIntegration,
  getIntegrationsHealth,
  getLiveness,
  getLocalizationSettings,
  getRateLimits,
  getEngineStatuses,
  getReadiness,
  getSessionPolicy,
  getStorageStatus,
  getSupportAccessSetting,
  getSystemHealth,
  getWebhook,
  grantSupportAccess,
  listApiClients,
  listControlEvidence,
  listIntegrations,
  listJobRuns,
  listSupportAccessEvents,
  listWebhookDeliveries,
  listWebhooks,
  retryWebhookDelivery,
  revokeApiClient,
  rotateApiClient,
  testIntegration,
  testWebhook,
  updateControlEvidence,
  updateIntegration,
  updateLocalizationSettings,
  updateRateLimits,
  updateSessionPolicy,
  updateSupportAccessSetting,
  updateWebhook,
} from './system';
import { getSettingsSnapshot } from './settings';
import { ctxFor, expectJunkIdsForbiddenLive, expectJunkIdsInvalidLive, expectValid, resetGoTestState, withTempDemoState } from './test-support';

withTempDemoState();
beforeEach(async () => {
  await resetGoTestState();
});

const admin = () => ctxFor('administrator');
const OTHERS = ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const;

describe('system health (Admin 15)', () => {
  it('reports health, feeds, jobs, storage and backups, and validates against the contract', async () => {
    const ctx = admin();
    const health = await getSystemHealth(ctx);
    expectValid('HealthOverview', health);
    expect(health.feeds).toHaveLength(fixtureRecords<Integration>('Integration').length);
    expect(health.overall).toBe('degraded');
    expect(health.last_job_failure_at).not.toBeNull();
    const jobs = await listJobRuns(ctx, { limit: 200 });
    expectValid('JobRunList', jobs);
    expect(jobs.items.length).toBeGreaterThan(5);
    expect((await listJobRuns(ctx, { status: 'failed' })).items.every((j) => j.status === 'failed')).toBe(true);
    expect((await listJobRuns(ctx, { kind: 'forecast' })).items.every((j) => j.kind === 'forecast')).toBe(true);
    expectValid('StorageStatus', await getStorageStatus(ctx));
    const engines = await getEngineStatuses(ctx);
    expectValid('EngineStatuses', engines);
    expect(engines.items.map((e) => e.engine)).toEqual(['forecaster', 'optimizer', 'simulator', 'assignment']);
    expectValid('BackupStatus', await getBackupStatus(ctx));
    expect((await getStorageStatus(ctx)).used_bytes).toBeLessThan((await getStorageStatus(ctx)).total_bytes);
  });

  it('confirms a backup and creates a diagnostics file with no personal data, both audited', async () => {
    const ctx = admin();
    const before = await getBackupStatus(ctx);
    const after = await confirmBackup(ctx, { note: 'Confirmed with the infrastructure team.' });
    expectValid('BackupStatus', after);
    expect(after.confirmed_by_user_id).toBe(ctx.userId);
    expect(Date.parse(after.last_confirmed_at as string)).toBeGreaterThan(Date.parse(before.last_confirmed_at as string));
    const bundle = await createDiagnosticsBundle(ctx);
    expectValid('DiagnosticsBundle', bundle);
    expect(bundle.personal_data_removed).toBe(true);
    const file = await downloadDiagnosticsBundle(ctx, bundle.id);
    const zip = Buffer.from(file.content_base64, 'base64');
    expect(file.content_type).toBe('application/zip');
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    const text = zip.toString('utf8');
    expect(text).toContain('settings.json');
    expect(text).not.toMatch(/@demo-synthetic\.example/);
    expect(zip.length).toBe(bundle.size_bytes);
    await expect(downloadDiagnosticsBundle(ctx, '00000000-0000-4000-8000-000000000000')).rejects.toThrow(NotFoundError);
    const actions = (await listAuditEvents(ctx, { limit: 5 })).items.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['backup.confirmed', 'diagnostics.created']));
  });

  it('answers the health probes for every role in the install mode', async () => {
    expect((await getLiveness(ctxFor('planner'))).status).toBe('ok');
    expect(await getReadiness(ctxFor('planner'))).toMatchObject({ status: 'degraded' });
    expectValid('HealthStatus', await getReadiness(ctxFor('planner')));
    await expect(getLiveness(ctxFor('change_approver', { installMode: 'shared' }))).rejects.toThrow(ForbiddenError);
  });

  it('is for the Administrator only', async () => {
    for (const role of OTHERS) {
      await expect(getSystemHealth(ctxFor(role))).rejects.toThrow(ForbiddenError);
      await expect(getEngineStatuses(ctxFor(role))).rejects.toThrow(ForbiddenError);
      await expect(confirmBackup(ctxFor(role), {})).rejects.toThrow(ForbiddenError);
    }
    expect((await listAuditEvents(admin(), { outcome: 'denied', action: 'backup.confirmed' })).items).toHaveLength(6);
  });
});

describe('security and compliance (Admin 14)', () => {
  it('lists the controls evidence and updates one, audited', async () => {
    const ctx = admin();
    const controls = await listControlEvidence(ctx, { limit: 200 });
    expectValid('ControlEvidenceList', controls);
    expect(controls.items.some((c) => c.framework === 'NCA')).toBe(true);
    expect(controls.items.some((c) => c.framework === 'PDPL')).toBe(true);
    expect((await listControlEvidence(ctx, { framework: 'PDPL' })).items.every((c) => c.framework === 'PDPL')).toBe(true);
    const target = controls.items.find((c) => c.status === 'not_started')!;
    const updated = await updateControlEvidence(ctx, target.id, { status: 'evidenced', evidence_note: 'Contact list attached.' });
    expectValid('ControlEvidence', updated);
    expect(updated).toMatchObject({ status: 'evidenced', evidence_note: 'Contact list attached.' });
    expect(updated.reviewed_at).not.toBeNull();
    await expect(updateControlEvidence(ctx, target.id, { status: 'done' })).rejects.toThrow(InvalidInputError);
    expect((await listAuditEvents(ctx, { action: 'control_evidence.updated' })).items).toHaveLength(1);
  });

  it('reads and updates the session policy and support access, and lists the support access log', async () => {
    const ctx = admin();
    expectValid('SessionPolicy', await getSessionPolicy(ctx));
    const policy = await updateSessionPolicy(ctx, { session_length_minutes: 240, idle_timeout_minutes: 20, max_concurrent_sessions: 2 });
    expect(await getSessionPolicy(ctx)).toEqual(policy);
    await expect(updateSessionPolicy(ctx, { session_length_minutes: 10, idle_timeout_minutes: 30, max_concurrent_sessions: 2 })).rejects.toThrow(InvalidInputError);
    await expect(updateSessionPolicy(ctx, { session_length_minutes: 4, idle_timeout_minutes: 1, max_concurrent_sessions: 2 })).rejects.toThrow(InvalidInputError);
    expect(await getSupportAccessSetting(ctx)).toEqual({ enabled: false, max_duration_hours: 8 });
    expect(await updateSupportAccessSetting(ctx, { enabled: true, max_duration_hours: 4 })).toEqual({ enabled: true, max_duration_hours: 4 });
    expectValid('SupportAccessSetting', await getSupportAccessSetting(ctx));
    const events = await listSupportAccessEvents(ctx);
    expectValid('SupportAccessEventList', events);
    expect(events.items.length).toBeGreaterThan(0);
    expect((await listAuditEvents(ctx, { limit: 5 })).items.map((e) => e.action)).toEqual(expect.arrayContaining(['session_policy.updated', 'support_access.updated']));
  });

  it('is readable by the Administrator only', async () => {
    for (const role of OTHERS) await expect(listControlEvidence(ctxFor(role))).rejects.toThrow(ForbiddenError);
    await expect(updateSessionPolicy(ctxFor('planner'), { session_length_minutes: 240, idle_timeout_minutes: 20, max_concurrent_sessions: 2 })).rejects.toThrow(ForbiddenError);
  });
});

describe('API clients and webhooks (Admin 13)', () => {
  it('creates a client, shows the secret once, and stores only a hint; revokes it', async () => {
    const ctx = admin();
    const seeded = await listApiClients(ctx);
    expectValid('ApiClientList', seeded);
    expect(seeded.items.length).toBe(3);
    const created = await createApiClient(ctx, { name: 'Analytics export', scopes: ['read'] });
    expectValid('ApiClientCreated', created);
    expect(created.secret.length).toBeGreaterThanOrEqual(16);
    expect(created.client.secret_hint).toBe(created.secret.slice(-4));
    const stored = JSON.stringify((await listApiClients(ctx)).items);
    expect(stored).not.toContain(created.secret);
    expect(JSON.stringify((await listAuditEvents(ctx, { action: 'api_client.created' })).items)).not.toContain(created.secret);
    const rotated = await rotateApiClient(ctx, created.client.id);
    expectValid('ApiClientCreated', rotated);
    expect(rotated.secret).not.toBe(created.secret);
    expect(rotated.client.secret_hint).toBe(rotated.secret.slice(-4));
    expect((await listApiClients(ctx)).items.find((c) => c.id === created.client.id)?.secret_hint).toBe(rotated.secret.slice(-4));
    const rotations = (await listAuditEvents(ctx, { action: 'api_client.rotated' })).items;
    expect(rotations).toHaveLength(1);
    expect(JSON.stringify(rotations)).not.toContain(rotated.secret);
    await revokeApiClient(ctx, created.client.id);
    expect((await listApiClients(ctx)).items.find((c) => c.id === created.client.id)?.is_revoked).toBe(true);
    await expect(revokeApiClient(ctx, created.client.id)).rejects.toThrow(ConflictError);
    await expect(rotateApiClient(ctx, created.client.id)).rejects.toThrow(ConflictError);
    await expect(createApiClient(ctx, { name: 'x', scopes: [] })).rejects.toThrow(InvalidInputError);
    await expect(createApiClient(ctx, { name: 'x', scopes: ['admin'] })).rejects.toThrow(InvalidInputError);
  });

  it('creates, updates, tests and deletes a webhook by script, with a delivery log', async () => {
    const ctx = admin();
    const hooks = await listWebhooks(ctx);
    expectValid('WebhookList', hooks);
    const seeded = hooks.items[0]!;
    expect((await listWebhookDeliveries(ctx, seeded.id)).items.length).toBe(3);
    expectValid('WebhookDeliveryList', await listWebhookDeliveries(ctx, seeded.id));
    const created = await createWebhook(ctx, { name: 'Fallback alerts', target_url: 'https://hooks.example.com/opendispatch/fallback', event_types: ['fallback.state_changed'] });
    expectValid('Webhook', created);
    expect(created).toMatchObject({ is_enabled: true, last_status: null });
    const ok = await testWebhook(ctx, created.id);
    expectValid('WebhookTestResult', ok);
    expect(ok).toMatchObject({ delivered: true, http_status: 200 });
    // Review m7: a scripted test says so in the audit trail (the result type has no field for it).
    const testEvent = (await listAuditEvents(ctx, { action: 'webhook.tested' })).items[0]!;
    expect(testEvent.summary_en).toContain('(stub: nothing was sent)');
    expect(testEvent.detail).toMatchObject({ stub: true });
    expect(await getWebhook(ctx, created.id)).toMatchObject({ last_status: 'succeeded' });
    const broken = await updateWebhook(ctx, created.id, { name: 'Fallback alerts', target_url: 'https://fail.example.com/hook', event_types: ['fallback.state_changed'], is_enabled: true });
    expect(await testWebhook(ctx, broken.id)).toMatchObject({ delivered: false, http_status: 500 });
    expect((await listWebhookDeliveries(ctx, created.id)).items.map((d) => d.status)).toEqual(['failed', 'succeeded']);
    await expect(createWebhook(ctx, { name: 'x', target_url: 'http://insecure.example.com', event_types: ['rule.approved'] })).rejects.toThrow(InvalidInputError);
    await expect(createWebhook(ctx, { name: 'x', target_url: 'nonsense', event_types: ['rule.approved'] })).rejects.toThrow(InvalidInputError);
    await expect(createWebhook(ctx, { name: 'x', target_url: 'https://a.example.com', event_types: ['nothing'] })).rejects.toThrow(InvalidInputError);
    await deleteWebhook(ctx, created.id);
    await expect(getWebhook(ctx, created.id)).rejects.toThrow(NotFoundError);
    expect((await listAuditEvents(ctx, { limit: 30 })).items.map((e) => e.action)).toEqual(expect.arrayContaining(['webhook.created', 'webhook.tested', 'webhook.updated', 'webhook.deleted']));
  });

  it('is for the Administrator only, and persists across a fresh module instance', async () => {
    for (const role of OTHERS) await expect(listApiClients(ctxFor(role))).rejects.toThrow(ForbiddenError);
    const seededId = (await listApiClients(admin())).items[0]!.id;
    for (const role of OTHERS) await expect(rotateApiClient(ctxFor(role), seededId)).rejects.toThrow(ForbiddenError);
    await expect(createWebhook(ctxFor('planner'), { name: 'x', target_url: 'https://a.example.com', event_types: ['rule.approved'] })).rejects.toThrow(ForbiddenError);
    const ctx = admin();
    const created = await createApiClient(ctx, { name: 'Persist', scopes: ['feeds'] });
    vi.resetModules();
    const fresh = await import('./system');
    expect((await fresh.listApiClients(ctx)).items.map((c) => c.id)).toContain(created.client.id);
    await resetGoTestState();
    expect((await listApiClients(ctx)).items.map((c) => c.id)).not.toContain(created.client.id);
    expect((await listApiClients(ctx)).items).toHaveLength(3);
  });
});

describe('integrations (Admin 9)', () => {
  it('lists the fixture integrations with their health, tests them by script, and validates against the contract', async () => {
    const ctx = admin();
    const list = await listIntegrations(ctx);
    expect(list.items).toHaveLength(fixtureRecords<Integration>('Integration').length);
    expectValid('IntegrationList', list);
    const health = await getIntegrationsHealth(ctx);
    expectValid('IntegrationsHealth', health);
    expect(health.overall).toBe('degraded');
    const caseFeed = list.items.find((i) => i.kind === 'case_feed')!;
    const agentFeed = list.items.find((i) => i.kind === 'agent_feed')!;
    const weather = list.items.find((i) => i.kind === 'weather_feed')!;
    expect(await testIntegration(ctx, caseFeed.id)).toMatchObject({ ok: true, message: 'Answer scripted from the stored health (stub: nothing was sent).' });
    expectValid('IntegrationTestResult', await testIntegration(ctx, caseFeed.id));
    expect(await testIntegration(ctx, agentFeed.id)).toMatchObject({ ok: true, message: 'Answered, but slowly. (stub: nothing was sent)' });
    expect(await testIntegration(ctx, weather.id)).toMatchObject({ ok: false, latency_ms: null });
    expectValid('Integration', await getIntegration(ctx, caseFeed.id));
  });

  it('updates an integration, refuses a raw secret as a credential, and switches one on and off', async () => {
    const ctx = admin();
    const weather = (await listIntegrations(ctx)).items.find((i) => i.kind === 'weather_feed')!;
    await expect(updateIntegration(ctx, weather.id, { credential_ref: 'hunter2-the-real-password' })).rejects.toThrow(InvalidInputError);
    const on = await updateIntegration(ctx, weather.id, { is_enabled: true, endpoint_label: 'Simulated weather feed', credential_ref: 'secret://opendispatch/weather_feed' });
    expectValid('Integration', on);
    expect(on).toMatchObject({ is_enabled: true, health: 'unknown', credential_ref: 'secret://opendispatch/weather_feed' });
    expect((await updateIntegration(ctx, weather.id, { is_enabled: false })).health).toBe('disabled');
    const channel = (await listIntegrations(ctx)).items.find((i) => i.kind === 'assignment_channel')!;
    expect((await updateIntegration(ctx, channel.id, { fallback_timeout_seconds: 8 })).fallback_timeout_seconds).toBe(8);
    await expect(updateIntegration(ctx, channel.id, { fallback_timeout_seconds: 0 })).rejects.toThrow(InvalidInputError);
    expect((await listAuditEvents(ctx, { action: 'integration.updated' })).items).toHaveLength(3);
  });

  it('is for the Administrator only', async () => {
    for (const role of OTHERS) await expect(listIntegrations(ctxFor(role))).rejects.toThrow(ForbiddenError);
    await expect(updateIntegration(ctxFor('planner'), (await listIntegrations(admin())).items[0]!.id, { is_enabled: false })).rejects.toThrow(ForbiddenError);
  });
});

describe('localisation (Admin 17)', () => {
  it('reads the defaults, updates the numeral system and calendar, and the settings snapshot follows', async () => {
    const ctx = admin();
    const settings = await getLocalizationSettings(ctx);
    expectValid('LocalizationSettings', settings);
    expect(settings).toMatchObject({ default_locale: 'en', digit_system: 'western', primary_calendar: 'gregorian', time_zone: 'Asia/Riyadh' });
    const next = await updateLocalizationSettings(ctx, { ...settings, default_locale: 'ar', digit_system: 'arabic_indic', primary_calendar: 'hijri', show_secondary_calendar: false, first_day_of_week: 'saturday' });
    expect(next).toMatchObject({ default_locale: 'ar', digit_system: 'arabic_indic' });
    expect((await getSettingsSnapshot(ctxFor('planner'))).localization).toEqual(next);
    await expect(updateLocalizationSettings(ctx, { ...settings, digit_system: 'roman' })).rejects.toThrow(InvalidInputError);
    await expect(updateLocalizationSettings(ctx, { ...settings, time_zone: 'Europe/London' })).rejects.toThrow(InvalidInputError);
    expect((await listAuditEvents(ctx, { action: 'localization.updated' })).items).toHaveLength(1);
    for (const role of OTHERS) await expect(getLocalizationSettings(ctxFor(role))).rejects.toThrow(ForbiddenError);
    await resetGoTestState();
    expect((await getLocalizationSettings(ctx)).digit_system).toBe('western');
  });
});

// ---------------------------------------------------------------------------------------------
// DG3: grant and end vendor support access
// ---------------------------------------------------------------------------------------------

describe('support access grants (DG3)', () => {
  const HOUR = 3_600_000;
  const enable = async (ctx = admin(), max = 4) => await updateSupportAccessSetting(ctx, { enabled: true, max_duration_hours: max });

  it('refuses a grant while the setting is off (the default): nothing is written and nothing is audited as denied', async () => {
    const ctx = admin();
    await expect(grantSupportAccess(ctx, { hours: 2, reason: 'Onboarding call.' })).rejects.toThrow(ConflictError);
    expect((await listAuditEvents(ctx, { action: 'support_access.granted' })).items).toEqual([]);
  });

  it('grants access for a limited time: a log entry for the caller that ends by itself, audited, and open until then', async () => {
    const ctx = admin();
    await enable(ctx);
    const before = Date.now();
    const event = await grantSupportAccess(ctx, { hours: 2, reason: 'Onboarding call.' });
    expectValid('SupportAccessEvent', event);
    expect(event).toMatchObject({ granted_by_user_id: ctx.userId, reason: 'Onboarding call.', created_by: ctx.userId, data_source: 'SYNTHETIC', tenant_id: ctx.customerId });
    expect(Date.parse(event.started_at)).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000 - 1000);
    expect(Date.parse(event.ended_at as string) - Date.parse(event.started_at)).toBe(2 * HOUR);
    expect((await listSupportAccessEvents(ctx)).items[0]?.id).toBe(event.id);
    const audit = (await listAuditEvents(ctx, { action: 'support_access.granted' })).items;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ outcome: 'success', entity_type: 'support_access', entity_id: event.id, actor_user_id: ctx.userId, detail: { hours: 2 } });
    // one grant is open at a time
    await expect(grantSupportAccess(ctx, { hours: 1, reason: 'Again.' })).rejects.toThrow(ConflictError);
    expect((await listSupportAccessEvents(ctx, { limit: 200 })).items.filter((e) => Date.parse(e.ended_at as string) > Date.now())).toHaveLength(1);
  });

  it('allows at most the longest grant of the setting, whole hours, and a reason of 1 to 500 characters', async () => {
    const ctx = admin();
    await enable(ctx, 4);
    for (const hours of [0, 5, 73, -1, 1.5, '2', null, undefined, Number.NaN]) await expect(grantSupportAccess(ctx, { hours, reason: 'x' }), String(hours)).rejects.toThrow(InvalidInputError);
    for (const reason of ['', 'a'.repeat(501), 7, null, undefined]) await expect(grantSupportAccess(ctx, { hours: 2, reason }), String(reason)).rejects.toThrow(InvalidInputError);
    await expect(grantSupportAccess(ctx, { hours: 2, reason: 'x', role: 'administrator' })).rejects.toThrow(InvalidInputError);
    await expect(grantSupportAccess(ctx, 'nope')).rejects.toThrow(InvalidInputError);
    expect((await listSupportAccessEvents(ctx, { limit: 200 })).items).toHaveLength(1); // the seed only
    await enable(ctx, 72);
    expect((await grantSupportAccess(ctx, { hours: 72, reason: 'a'.repeat(500) })).reason).toHaveLength(500);
  });

  it('ends a grant now: the end moves forward, it is audited, and a grant that has ended cannot be ended again', async () => {
    const ctx = admin();
    await enable(ctx);
    const event = await grantSupportAccess(ctx, { hours: 3, reason: 'Investigating.' });
    const ended = await endSupportAccess(ctx, event.id);
    expectValid('SupportAccessEvent', ended);
    expect(ended.id).toBe(event.id);
    expect(Date.parse(ended.ended_at as string)).toBeLessThanOrEqual(Date.now() + 1000);
    expect(Date.parse(ended.ended_at as string)).toBeLessThan(Date.parse(event.ended_at as string));
    expect(ended.started_at).toBe(event.started_at);
    expect((await listAuditEvents(ctx, { action: 'support_access.ended' })).items[0]).toMatchObject({ outcome: 'success', entity_id: event.id, actor_user_id: ctx.userId });
    await expect(endSupportAccess(ctx, event.id)).rejects.toThrow(ConflictError);
    const seeded = (await listSupportAccessEvents(ctx, { limit: 200 })).items.find((e) => e.id !== event.id)!;
    await expect(endSupportAccess(ctx, seeded.id)).rejects.toThrow(ConflictError);
    await expect(endSupportAccess(ctx, '00000000-0000-4000-8000-000000000000')).rejects.toThrow(NotFoundError);
    // after the end a new grant is possible
    expect((await grantSupportAccess(ctx, { hours: 1, reason: 'Second call.' })).granted_by_user_id).toBe(ctx.userId);
  });

  it('is the Administrator only, in every install mode; every other role is forbidden, and the denial is audited', async () => {
    await enable(admin());
    const event = await grantSupportAccess(admin(), { hours: 1, reason: 'x' });
    for (const role of OTHERS) {
      const ctx = ctxFor(role);
      await expect(grantSupportAccess(ctx, { hours: 1, reason: 'x' }), role).rejects.toThrow(ForbiddenError);
      await expect(endSupportAccess(ctx, event.id), role).rejects.toThrow(ForbiddenError);
    }
    expect((await listAuditEvents(admin(), { action: 'support_access.granted', outcome: 'denied', limit: 200 })).items).toHaveLength(OTHERS.length);
    await endSupportAccess(admin(), event.id);
    for (const installMode of ['dedicated', 'shared'] as const) {
      const ctx = ctxFor('administrator', { installMode });
      const granted = await grantSupportAccess(ctx, { hours: 1, reason: `In a ${installMode} install.` });
      expect((await endSupportAccess(ctx, granted.id)).id).toBe(granted.id);
    }
  });

  it('checks the role before it looks at the id, and refuses a crafted id with no change', async () => {
    await enable(admin());
    await expectJunkIdsInvalidLive((id) => endSupportAccess(admin(), id));
    await expectJunkIdsForbiddenLive((id) => endSupportAccess(ctxFor('planner'), id));
  });
});

// ---------------------------------------------------------------------------------------------
// DG9: API rate limits (stored, not enforced)
// ---------------------------------------------------------------------------------------------

describe('API rate limits (DG9)', () => {
  const defaults = [
    { scope: 'read', requests_per_minute: 120, burst: 20 },
    { scope: 'write', requests_per_minute: 30, burst: 5 },
    { scope: 'feeds', requests_per_minute: 600, burst: 100 },
  ];

  it('starts with the defaults of the mockup, one entry for each scope, and validates against the contract', async () => {
    const limits = await getRateLimits(admin());
    expectValid('ApiRateLimits', limits);
    expect(limits.limits).toEqual(defaults);
  });

  it('replaces the limits, keeps them, audits the change with the old and the new figures, and resets with the demo', async () => {
    const ctx = admin();
    const next = { limits: [{ scope: 'feeds', requests_per_minute: 900, burst: 150 }, { scope: 'read', requests_per_minute: 60, burst: 10 }, { scope: 'write', requests_per_minute: 15, burst: 3 }] };
    const saved = await updateRateLimits(ctx, next);
    expectValid('ApiRateLimits', saved);
    expect(saved.limits.map((l) => l.scope)).toEqual(['read', 'write', 'feeds']); // always in scope order
    expect((await getRateLimits(ctx)).limits).toEqual([{ scope: 'read', requests_per_minute: 60, burst: 10 }, { scope: 'write', requests_per_minute: 15, burst: 3 }, { scope: 'feeds', requests_per_minute: 900, burst: 150 }]);
    const event = (await listAuditEvents(ctx, { action: 'api_rate_limits.updated' })).items[0]!;
    expect(event).toMatchObject({ outcome: 'success', actor_user_id: ctx.userId, entity_type: 'setting' });
    expect(JSON.stringify(event.detail)).toContain('900');
    expect(JSON.stringify(event.detail)).toContain('120');
    await resetGoTestState();
    expect((await getRateLimits(ctx)).limits).toEqual(defaults);
  });

  it('needs exactly one entry for each of read, write and feeds, whole numbers in range, and no other field', async () => {
    const ctx = admin();
    const ok = defaults;
    for (const bad of [
      { limits: ok.slice(0, 2) },
      { limits: [...ok, { scope: 'read', requests_per_minute: 1, burst: 1 }] },
      { limits: [ok[0], ok[0], ok[2]] },
      { limits: [{ scope: 'admin', requests_per_minute: 1, burst: 1 }, ok[1], ok[2]] },
      { limits: [{ ...ok[0], requests_per_minute: 0 }, ok[1], ok[2]] },
      { limits: [{ ...ok[0], requests_per_minute: 100_001 }, ok[1], ok[2]] },
      { limits: [{ ...ok[0], requests_per_minute: 1.5 }, ok[1], ok[2]] },
      { limits: [{ ...ok[0], burst: 0 }, ok[1], ok[2]] },
      { limits: [{ ...ok[0], burst: 10_001 }, ok[1], ok[2]] },
      { limits: [{ ...ok[0], extra: 1 }, ok[1], ok[2]] },
      { limits: 'all' },
      { limits: ok, role: 'administrator' },
      {},
      null,
    ]) {
      await expect(updateRateLimits(ctx, bad), JSON.stringify(bad)).rejects.toThrow(InvalidInputError);
    }
    expect((await getRateLimits(ctx)).limits).toEqual(defaults);
    expect((await listAuditEvents(ctx, { action: 'api_rate_limits.updated' })).items).toEqual([]);
  });

  it('is the Administrator only: reads and writes are forbidden to every other role, and a refused write is audited and changes nothing', async () => {
    for (const role of OTHERS) {
      await expect(getRateLimits(ctxFor(role)), role).rejects.toThrow(ForbiddenError);
      await expect(updateRateLimits(ctxFor(role), { limits: defaults }), role).rejects.toThrow(ForbiddenError);
    }
    expect((await listAuditEvents(admin(), { action: 'api_rate_limits.updated', outcome: 'denied', limit: 200 })).items).toHaveLength(OTHERS.length);
    // the role check comes first: a body that would be invalid is still forbidden
    await expect(updateRateLimits(ctxFor('planner'), 'nonsense')).rejects.toThrow(ForbiddenError);
  });
});

// ---------------------------------------------------------------------------------------------
// DG10: retry a webhook delivery (scripted)
// ---------------------------------------------------------------------------------------------

describe('retry a webhook delivery (DG10)', () => {
  const failedDelivery = async (ctx = admin()) => {
    const hook = (await listWebhooks(ctx)).items[0]!;
    return { hook, delivery: (await listWebhookDeliveries(ctx, hook.id)).items.find((d) => d.status === 'failed')! };
  };

  it('retries a failed delivery by script: nothing is sent, the attempt count goes up, the result says it is a stub, and it is audited', async () => {
    const ctx = admin();
    const { hook, delivery } = await failedDelivery(ctx);
    expect(delivery.attempt_count).toBe(3);
    const result = await retryWebhookDelivery(ctx, delivery.id);
    expectValid('WebhookDeliveryRetryResult', result);
    expect(result.delivered).toBe(true);
    expect(result.message).toContain('(stub: nothing was sent)');
    expect(result.delivery).toMatchObject({ id: delivery.id, webhook_id: hook.id, status: 'succeeded', http_status: 200, attempt_count: 4, error_message: null, data_source: 'SYNTHETIC' });
    expect(Date.parse(result.delivery.attempted_at)).toBeGreaterThan(Date.parse(delivery.attempted_at));
    expect((await listWebhookDeliveries(ctx, hook.id)).items.find((d) => d.id === delivery.id)).toEqual(result.delivery);
    expect((await listWebhookDeliveries(ctx, hook.id)).items).toHaveLength(3); // the same delivery, not a new one
    expect(await getWebhook(ctx, hook.id)).toMatchObject({ last_status: 'succeeded' });
    const event = (await listAuditEvents(ctx, { action: 'webhook.delivery_retried' })).items[0]!;
    expect(event).toMatchObject({ outcome: 'success', entity_type: 'webhook_delivery', entity_id: delivery.id, actor_user_id: ctx.userId });
    expect(event.summary_en).toContain('(stub: nothing was sent)');
    expect(event.detail).toMatchObject({ stub: true, attempt_count: 4 });
  });

  it('fails again for a target that contains "fail", and raises the attempt count each time', async () => {
    const ctx = admin();
    const { hook, delivery } = await failedDelivery(ctx);
    await updateWebhook(ctx, hook.id, { name: hook.name, target_url: 'https://fail.example.com/hook', event_types: hook.event_types, is_enabled: true });
    const first = await retryWebhookDelivery(ctx, delivery.id);
    expect(first).toMatchObject({ delivered: false, delivery: { status: 'failed', http_status: 500, attempt_count: 4, error_message: 'The target answered with 500.' } });
    expect(first.message).toContain('(stub: nothing was sent)');
    expect((await retryWebhookDelivery(ctx, delivery.id)).delivery.attempt_count).toBe(5);
    expect(await getWebhook(ctx, hook.id)).toMatchObject({ last_status: 'failed' });
  });

  it('retries only a failed delivery, and a delivery that exists', async () => {
    const ctx = admin();
    const { hook, delivery } = await failedDelivery(ctx);
    const succeeded = (await listWebhookDeliveries(ctx, hook.id)).items.find((d) => d.status === 'succeeded')!;
    await expect(retryWebhookDelivery(ctx, succeeded.id)).rejects.toThrow(ConflictError);
    await retryWebhookDelivery(ctx, delivery.id);
    await expect(retryWebhookDelivery(ctx, delivery.id)).rejects.toThrow(ConflictError); // it succeeded now
    await expect(retryWebhookDelivery(ctx, '00000000-0000-4000-8000-000000000000')).rejects.toThrow(NotFoundError);
    expect((await listAuditEvents(ctx, { action: 'webhook.delivery_retried', limit: 200 })).items).toHaveLength(1);
  });

  it('is the Administrator only: another role is forbidden and the denial is audited, whatever id it sends', async () => {
    const { delivery } = await failedDelivery();
    for (const role of OTHERS) {
      await expect(retryWebhookDelivery(ctxFor(role), delivery.id), role).rejects.toThrow(ForbiddenError);
    }
    expect((await listAuditEvents(admin(), { action: 'webhook.delivery_retried', outcome: 'denied', limit: 200 })).items).toHaveLength(OTHERS.length);
    await expectJunkIdsForbiddenLive((id) => retryWebhookDelivery(ctxFor('viewer_auditor'), id));
    await expectJunkIdsInvalidLive((id) => retryWebhookDelivery(admin(), id));
  });
});
