// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { listAuditEvents } from './audit';
import { resetDemoData } from './demo';
import { ForbiddenError, UnauthenticatedError } from './errors';
import { updateQuietHours } from './notifications';
import { ctxFor, expectValid, withTempDemoState } from './test-support';

withTempDemoState();

const ROLES = ['administrator', 'dispatch_supervisor', 'dispatcher', 'planner', 'remote_team_lead', 'viewer_auditor', 'change_approver'] as const;
const QUIET = { enabled: false, start: '22:30', end: '06:15', applies_to: 'email_and_in_app' };

async function addMarker(): Promise<void> {
  await updateQuietHours(ctxFor('administrator'), QUIET);
}

describe('resetDemoData (POST /demo/reset)', () => {
  it('restores the fixtures: the audit log is append only, so earlier events stay, and the reset audits itself', async () => {
    const admin = ctxFor('administrator');
    await addMarker();
    expect((await listAuditEvents(admin, { action: 'quiet_hours.updated' })).items).toHaveLength(1);
    const result = await resetDemoData(admin);
    expectValid('DemoResetResult', result);
    expect(result.cleared).toBe(true);
    expect((await listAuditEvents(admin, { action: 'quiet_hours.updated' })).items).toHaveLength(1);
    const event = (await listAuditEvents(admin, { action: 'demo.reset' })).items[0]!;
    expectValid('AuditEvent', event);
    expect(event).toMatchObject({ action: 'demo.reset', outcome: 'success', actor_user_id: admin.userId, entity_type: 'demo' });
  });

  it('is for an Administrator only: every other role gets forbidden, nothing is wiped and the attempt is audited', async () => {
    const admin = ctxFor('administrator');
    await addMarker();
    const others = ROLES.filter((role) => role !== 'administrator');
    for (const role of others) await expect(resetDemoData(ctxFor(role)), role).rejects.toThrow(ForbiddenError);
    expect((await listAuditEvents(admin, { action: 'quiet_hours.updated' })).items).toHaveLength(1);
    const denied = (await listAuditEvents(admin, { action: 'demo.reset', outcome: 'denied', limit: 200 })).items;
    expect(denied).toHaveLength(others.length);
    expect(denied.map((e) => e.actor_user_id).sort()).toEqual(others.map((role) => ctxFor(role).userId).sort());
    expect((await resetDemoData(admin)).cleared).toBe(true);
  });

  it('is refused to a viewer or auditor in particular, before anything is wiped', async () => {
    await addMarker();
    await expect(resetDemoData(ctxFor('viewer_auditor'))).rejects.toThrow(/only an administrator may/);
    expect((await listAuditEvents(ctxFor('administrator'), { action: 'quiet_hours.updated' })).items).toHaveLength(1);
  });

  it('is refused in every install mode where the role does not exist, and open to the Administrator where it does', async () => {
    // Go refuses that session itself
    await expect(resetDemoData(ctxFor('change_approver', { installMode: 'shared' }))).rejects.toThrow(UnauthenticatedError);
    for (const installMode of ['private', 'dedicated', 'shared'] as const) expect((await resetDemoData(ctxFor('administrator', { installMode }))).cleared).toBe(true);
  });
});
