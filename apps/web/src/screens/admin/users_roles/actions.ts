'use server';
// SPDX-License-Identifier: AGPL-3.0-only

// The writes of the Users and Roles screen: exactly the data functions of lib/data/users.ts.
//
//   inviteUser            createUser                          (a person is created `invited`)
//   updateUserAccess      updateUser                          (name, role, zones)
//   disableUserAccount    disableUser        enableUserAccount    enableUser
//   disableUsers          disableUser once per person         (the bulk bar: N calls)
//   resetEmergencyPassword, resetEmergencyMfa                 (LABELLED STUBS: nothing changes, `stub: true` in the audit detail)
//
// Rule 2: no action takes a context, customer, user, role, zone scope or install mode from the browser. Each builds its own
// context with requireRequestContext() inside runAction, and the data function authorises, validates and audits. The people
// an action names are `targetUserId`s, the role a person is given is `assigned_role`; a viewer who calls an action gets
// `forbidden` and a `denied` audit event. The two resets take no argument at all: the server finds the emergency account.
// (tools/rules/context-rules.test.ts scans this file for those names.)

import { pickFields, pickText, pickTextList } from '@/lib/actions/pick';
import { runAction } from '@/lib/actions/run-action';
import type { ActionResult } from '@/lib/actions/types';
import { DataError, ForbiddenError, InvalidInputError, NotFoundError } from '@/lib/data/errors';
import type { RequestContext } from '@/lib/data/guard';
import { createUser, disableUser, enableUser, listUsers, resetEmergencyAdminMfa, resetEmergencyAdminPassword, updateUser } from '@/lib/data/users';
import type { BulkDisableResult, InviteUserInput, ResetResult, UpdateUserInput, UserSummary, UserTarget, UserTargets } from './types';

const REVALIDATE = '/admin/users-roles';
/** The bulk bar disables at most this many people in one call. */
const MAX_BULK = 100;

const summaryOf = (user: { id: string; display_name: string; assigned_role: string; status: string }): UserSummary => ({ id: user.id, name: user.display_name, assignedRole: user.assigned_role, status: user.status });

/** Invites a person: a name, an e-mail address, a role and (for the zone-scoped roles) zones. */
export async function inviteUser(input: InviteUserInput): Promise<ActionResult<UserSummary>> {
  return runAction(async (ctx) => summaryOf(await createUser(ctx, pickFields(input, ['email', 'display_name', 'assigned_role', 'zone_ids']))), { revalidate: REVALIDATE });
}

/** Changes a person's name, role and zones. */
export async function updateUserAccess(input: UpdateUserInput): Promise<ActionResult<UserSummary>> {
  return runAction(async (ctx) => summaryOf(await updateUser(ctx, pickText(input, 'targetUserId') ?? '', pickFields(input, ['display_name', 'assigned_role', 'zone_ids']))), { revalidate: REVALIDATE });
}

export async function disableUserAccount(input: UserTarget): Promise<ActionResult<UserSummary>> {
  return runAction(async (ctx) => summaryOf(await disableUser(ctx, pickText(input, 'targetUserId') ?? '')), { revalidate: REVALIDATE });
}

export async function enableUserAccount(input: UserTarget): Promise<ActionResult<UserSummary>> {
  return runAction(async (ctx) => summaryOf(await enableUser(ctx, pickText(input, 'targetUserId') ?? '')), { revalidate: REVALIDATE });
}

/**
 * Disables each person named, one data call each (each audited). A refusal for one person (yourself, the last Administrator,
 * already disabled) is counted and the rest go on; a refusal that concerns the caller (no session, no permission) stops at
 * the first person, so a viewer leaves one `denied` event and not a hundred.
 */
export async function disableUsers(input: UserTargets): Promise<ActionResult<BulkDisableResult>> {
  return runAction(
    async (ctx) => {
      const ids = pickTextList(input, 'targetUserIds', MAX_BULK);
      if (ids === undefined || ids.length === 0) throw new InvalidInputError(`Users: name 1 to ${MAX_BULK} people.`);
      let disabled = 0;
      let failed = 0;
      let firstProblem: string | undefined;
      for (const id of [...new Set(ids)]) {
        try {
          await disableUser(ctx, id);
          disabled += 1;
        } catch (error) {
          if (!(error instanceof DataError) || error.code === 'forbidden' || error.code === 'unauthenticated') throw error;
          failed += 1;
          firstProblem ??= error.message;
        }
      }
      return { disabled, failed, ...(firstProblem === undefined ? {} : { firstProblem }) } satisfies BulkDisableResult;
    },
    { revalidate: REVALIDATE },
  );
}

/** No account has this id. It stands in when the caller may not even read the user list, so the data function refuses and audits it. */
const NO_ACCOUNT = '00000000-0000-4000-8000-000000000000';

/**
 * The emergency administrator is the one local account; the server finds it, the browser names nobody. A
 * caller who may not read the users gets NO_ACCOUNT: the reset then fails its own permission check inside the audited write,
 * so the refused attempt leaves a `denied` event instead of failing earlier with nothing written.
 */
async function emergencyAdministratorId(ctx: RequestContext): Promise<string> {
  try {
    const account = (await listUsers(ctx, { limit: 200 })).items.find((user) => user.is_emergency_admin);
    if (account === undefined) throw new NotFoundError('There is no emergency administrator account.');
    return account.id;
  } catch (error) {
    if (error instanceof ForbiddenError) return NO_ACCOUNT;
    throw error;
  }
}

/** LABELLED STUB: writes the audit event and returns a hint; the real temporary secret is Keycloak's. */
export async function resetEmergencyPassword(): Promise<ActionResult<ResetResult>> {
  return runAction(async (ctx) => ({ hint: (await resetEmergencyAdminPassword(ctx, await emergencyAdministratorId(ctx))).temporary_secret_hint ?? '' }), { revalidate: REVALIDATE });
}

/** LABELLED STUB, as above, for the authenticator app. */
export async function resetEmergencyMfa(): Promise<ActionResult<ResetResult>> {
  return runAction(async (ctx) => ({ hint: (await resetEmergencyAdminMfa(ctx, await emergencyAdministratorId(ctx))).temporary_secret_hint ?? '' }), { revalidate: REVALIDATE });
}
