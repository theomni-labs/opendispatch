// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import { fixtureUsers, resetGoTestState } from '@/lib/data/go-test-reset';
import { buildContext, fixtureTenantId } from '@/lib/data/go-test-reset';
import type { RequestContext } from '@/lib/data/guard';
import { listZones } from '@/lib/data/locations';
import { createUser } from '@/lib/data/users';
import { loadAuditView } from './view';

// Live: skips, never fakes, if OPENDISPATCH_API_URL unset.
// Zones is api-backed; the audit log itself stays
// demo-store, out of api-backed scope.
const hasApi = process.env['OPENDISPATCH_API_URL'] !== undefined && process.env['OPENDISPATCH_API_URL'] !== '';
if (!hasApi) console.log('OPENDISPATCH_API_URL is not set: view.live.test.ts is skipped, not faked.');

beforeEach(async () => {
  await resetGoTestState();
});

function admin(): RequestContext {
  const tenant = fixtureTenantId();
  const built = buildContext({ role: 'administrator', installMode: 'private', zoneIds: [] }, fixtureUsers(), tenant);
  if (built === null) throw new Error('no context for administrator');
  return built;
}

describe.skipIf(!hasApi)('loadAuditView (live, real api and Postgres)', () => {
  it('sees events that a write appends (a created user shows as user.created), newest first', async () => {
    const ctx = admin();
    const zone = (await listZones(ctx)).items[0];
    await createUser(ctx, { email: 'audit.view@demo.example', display_name: 'Audit View', assigned_role: 'planner', zone_ids: [zone?.id] });
    const view = await loadAuditView(ctx, { q: 'user.created' }, undefined, Date.now());
    expect(view.rows[0]).toMatchObject({ action: 'user.created', actorName: expect.any(String) });
    // Audit log stays demo-store, reset per test.
    expect(view.counts.all).toBe(24);
    expect((await loadAuditView(ctx, {}, undefined, Date.now())).counts.last24h).toBe(1);
  });
});
