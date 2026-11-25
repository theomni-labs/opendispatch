// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import type { InstallMode, Role } from '@/lib/access';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import { ForbiddenError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { updateSignInPolicy } from '@/lib/data/identity';
import { grantSupportAccess, listControlEvidence, updateControlEvidence, updateSessionPolicy, updateSupportAccessSetting } from '@/lib/data/system';
import { loadMessages } from '@/i18n/messages';
import { messageLeaves } from '@/i18n/message-tree';
import { TITLE_KEY } from './titles';
import { hoursOf, loadSecurityView } from './view';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';

// The server side of the screen against the real data layer and its seeds (11 controls, the session policy, one support access),
// with the demo store in a temp folder.
beforeEach(async () => {
  await resetGoTestState();
});

function ctxOf(role: Role, installMode: InstallMode = 'private'): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role, installMode, zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error(`no context for ${role}`);
  return built;
}
const admin = () => ctxOf('administrator');
const NOW = Date.parse('2026-09-13T06:20:00+03:00');

describe('loadSecurityView: controls and figures', () => {
  it('counts the controls by status: evidenced of all, in progress, not started', async () => {
    const view = await loadSecurityView(admin(), {}, NOW);
    expect(view.counts).toEqual({ total: 11, evidenced: 5, inProgress: 3, notStarted: 2 });
    expect(view.all).toHaveLength(11);
    expect(view.sources).toEqual(['SYNTHETIC']);
  });

  it('gives each control as plain data: reference, English title, framework, status, note, when it was reviewed', async () => {
    const view = await loadSecurityView(admin(), {}, NOW);
    expect(view.all[0]).toMatchObject({ ref: 'NCA-AC-01', title: 'Access is limited by role and zone', framework: 'NCA', status: 'evidenced', note: 'Role matrix reviewed with the Administrator.' });
    expect(view.all[0]?.reviewedAt).toMatch(/^2026-09-0\d/);
    expect(view.all.find((control) => control.ref === 'NCA-IR-01')).toMatchObject({ status: 'not_started', note: '', reviewedAt: null });
  });

  it('filters by framework, status and a search over the title and the reference, and keeps the counts over all', async () => {
    const ctx = admin();
    expect((await loadSecurityView(ctx, { framework: 'PDPL' }, NOW)).controls).toHaveLength(4);
    expect((await loadSecurityView(ctx, { framework: 'other' }, NOW)).controls.map((control) => control.ref)).toEqual(['OpenDispatch-SUP-01']);
    expect((await loadSecurityView(ctx, { status: 'in_progress' }, NOW)).controls).toHaveLength(3);
    expect((await loadSecurityView(ctx, { q: 'BACKUP' }, NOW)).controls.map((control) => control.ref)).toEqual(['NCA-BK-01']);
    expect((await loadSecurityView(ctx, { q: 'pdpl-dr' }, NOW)).controls).toHaveLength(1);
    const none = await loadSecurityView(ctx, { framework: 'NCA', status: 'not_applicable' }, NOW);
    expect(none.controls).toEqual([]);
    expect(none.counts.total).toBe(11);
  });

  it('follows an evidence update', async () => {
    const ctx = admin();
    const control = (await listControlEvidence(ctx, { limit: 50 })).items.find((c) => c.control_ref === 'NCA-IR-01') as NonNullable<Awaited<ReturnType<typeof listControlEvidence>>['items'][number]>;
    await updateControlEvidence(ctx, control.id, { status: 'evidenced', evidence_note: 'Contact recorded.' });
    const view = await loadSecurityView(ctx, {}, NOW);
    expect(view.counts).toMatchObject({ evidenced: 6, notStarted: 1 });
    expect(view.all.find((c) => c.ref === 'NCA-IR-01')).toMatchObject({ status: 'evidenced', note: 'Contact recorded.' });
  });

  it('opens a control by id, and says so for an id that names none', async () => {
    const ctx = admin();
    const id = (await loadSecurityView(ctx, {}, NOW)).all[3]?.id as string;
    expect((await loadSecurityView(ctx, { control: id }, NOW)).openControl?.ref).toBe('NCA-CR-01');
    const missing = await loadSecurityView(ctx, { control: '00000000-0000-4000-8000-00000000dead' }, NOW);
    expect(missing.openControl).toBeUndefined();
    expect(missing.unknownControl).toBe(true);
  });
});

describe('loadSecurityView: sessions, MFA and support access', () => {
  it('reads the session policy and the MFA claim of the Sign-in policy', async () => {
    const ctx = admin();
    expect((await loadSecurityView(ctx, {}, NOW)).session).toEqual({ lengthMinutes: 480, idleMinutes: 30, perPerson: 3 });
    expect((await loadSecurityView(ctx, {}, NOW)).mfaRequired).toBe(false);
    await updateSessionPolicy(ctx, { session_length_minutes: 240, idle_timeout_minutes: 20, max_concurrent_sessions: 2 });
    await updateSignInPolicy(ctx, { force_sso_email_domains: [], require_mfa_claim: true, allow_local_users_for_outsiders: false, emergency_admin_enabled: true });
    const view = await loadSecurityView(ctx, {}, NOW);
    expect(view.session).toEqual({ lengthMinutes: 240, idleMinutes: 20, perPerson: 2 });
    expect(view.mfaRequired).toBe(true);
  });

  it('reads the support access setting (off by default, 8 hours) and its log with who granted it', async () => {
    const view = await loadSecurityView(admin(), {}, NOW);
    expect(view.support.enabled).toBe(false);
    expect(view.support.maxHours).toBe(8);
    expect(view.support.grants).toHaveLength(1);
    expect(view.support.grants[0]).toMatchObject({ hours: 2, grantedBy: 'Nadia Al-Ghalani', active: false, startedAt: '2026-08-20T10:00:00+03:00', endsAt: '2026-08-20T12:00:00+03:00' });
    expect(view.support.openGrantId).toBeNull();
  });

  it('shows a grant as active until its end, and names it as the open one; ended when the clock passes it', async () => {
    const ctx = admin();
    await updateSupportAccessSetting(ctx, { enabled: true, max_duration_hours: 8 });
    const granted = await grantSupportAccess(ctx, { hours: 3, reason: 'Investigating a feed.' });
    const now = Date.now();
    const during = await loadSecurityView(ctx, {}, now);
    expect(during.support.grants[0]).toMatchObject({ id: granted.id, hours: 3, active: true });
    expect(during.support.openGrantId).toBe(granted.id);
    const after = await loadSecurityView(ctx, {}, now + 4 * 3_600_000);
    expect(after.support.grants[0]?.active).toBe(false);
    expect(after.support.openGrantId).toBeNull();
  });

  it('counts whole hours of a window, at least one', () => {
    expect(hoursOf('2026-08-20T10:00:00+03:00', '2026-08-20T12:00:00+03:00')).toBe(2);
    expect(hoursOf('2026-08-20T10:00:00+03:00', '2026-08-20T10:10:00+03:00')).toBe(1);
    expect(hoursOf('2026-08-20T10:00:00+03:00', null)).toBe(0);
  });
});

describe('roles', () => {
  it('reads for the Administrator in every install mode and refuses every other role', async () => {
    for (const mode of ['private', 'dedicated', 'shared'] as const) await expect(loadSecurityView(ctxOf('administrator', mode), {}, NOW), mode).resolves.toBeDefined();
    for (const role of ['dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const) await expect(loadSecurityView(ctxOf(role), {}, NOW), role).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('the control titles the screen translates', () => {
  it('has a title in both languages for every seeded control, keyed by its reference', async () => {
    const en = messageLeaves(loadMessages('en', 'admin.security_compliance'));
    const ar = messageLeaves(loadMessages('ar', 'admin.security_compliance'));
    const view = await loadSecurityView(admin(), {}, NOW);
    for (const control of view.all) {
      const key = TITLE_KEY[control.ref];
      expect(key, control.ref).toBeDefined();
      expect(en[`admin.security_compliance.${key}`], `en ${key}`).toBe(control.title);
      expect(/[؀-ۿ]/.test(ar[`admin.security_compliance.${key}`] ?? ''), `ar ${key}`).toBe(true);
    }
  });
});
