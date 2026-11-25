'use server';
// SPDX-License-Identifier: AGPL-3.0-only

// The writes of the Security and Compliance screen: exactly the data functions of lib/data/system.ts and
// lib/data/identity.ts.
//
//   saveSessionPolicy      updateSessionPolicy
//   setMfaClaim            updateSignInPolicy       (the MFA claim is the Sign-in policy's: it needs edit on Sign-in and Identity)
//   saveEvidence           updateControlEvidence    (status and note; the file is NOT stored, see below)
//   saveSupportSetting     updateSupportAccessSetting
//   grantSupport           grantSupportAccess       (hours up to the setting's longest grant, and a reason)
//   endSupport             endSupportAccess
//
// Rule 2: no action takes a context, customer, user, role, zone scope or install mode from the browser. Each builds its own
// context with requireRequestContext() inside runAction, and the data function authorises, validates and audits.
//
// The evidence file is not stored by the data layer: the screen lets the person pick one (type and size are checked in the drop
// area) and labels it Demo, and nothing here receives it, so a file can never travel through an action.
//
// The MFA switch writes the rest of the Sign-in policy back as it is. In a shared install that policy is read only for the
// Administrator, so the write is refused and audited as denied: the switch is disabled with the reason there.

import { pickFields, pickText } from '@/lib/actions/pick';
import { runAction } from '@/lib/actions/run-action';
import type { ActionResult } from '@/lib/actions/types';
import { ForbiddenError, InvalidInputError } from '@/lib/data/errors';
import { getSignInPolicy, updateSignInPolicy } from '@/lib/data/identity';
import { endSupportAccess, grantSupportAccess, updateControlEvidence, updateSessionPolicy, updateSupportAccessSetting } from '@/lib/data/system';
import type { ControlStatus, EvidenceInput, EvidenceSaved, GrantInput, GrantSaved, GrantTarget, MfaInput, MfaSaved, SessionInput, SessionSaved, SupportSettingInput, SupportSettingSaved } from './types';

const REVALIDATE = '/admin/security-compliance';

/** Saves the session policy: length, idle timeout and sessions per person. */
export async function saveSessionPolicy(input: SessionInput): Promise<ActionResult<SessionSaved>> {
  return runAction(
    async (ctx) => {
      const saved = await updateSessionPolicy(ctx, pickFields(input, ['session_length_minutes', 'idle_timeout_minutes', 'max_concurrent_sessions']));
      return { lengthMinutes: saved.session_length_minutes, idleMinutes: saved.idle_timeout_minutes, perPerson: saved.max_concurrent_sessions } satisfies SessionSaved;
    },
    { revalidate: REVALIDATE },
  );
}

/** Requires (or stops requiring) an MFA claim at sign-in: the rest of the Sign-in policy is read and written back as it is. */
export async function setMfaClaim(input: MfaInput): Promise<ActionResult<MfaSaved>> {
  return runAction(
    async (ctx) => {
      const required = pickFields(input, ['required']).required;
      if (typeof required !== 'boolean') throw new InvalidInputError('MFA claim: say whether it is required.');
      // A role that may not even read the policy is refused by the write itself, so the refusal is audited.
      let current;
      try {
        current = await getSignInPolicy(ctx);
      } catch (error) {
        if (error instanceof ForbiddenError) await updateSignInPolicy(ctx, {});
        throw error;
      }
      const saved = await updateSignInPolicy(ctx, {
        force_sso_email_domains: current.force_sso_email_domains,
        require_mfa_claim: required,
        allow_local_users_for_outsiders: current.allow_local_users_for_outsiders,
        emergency_admin_enabled: current.emergency_admin_enabled,
      });
      return { required: saved.require_mfa_claim } satisfies MfaSaved;
    },
    { revalidate: REVALIDATE },
  );
}

/** Sets a control's status and evidence note. Nothing else is stored: not a file, not its name. */
export async function saveEvidence(input: EvidenceInput): Promise<ActionResult<EvidenceSaved>> {
  return runAction(
    async (ctx) => {
      const saved = await updateControlEvidence(ctx, pickText(input, 'controlId') ?? '', pickFields(input, ['status', 'evidence_note']));
      return { ref: saved.control_ref, status: saved.status as ControlStatus } satisfies EvidenceSaved;
    },
    { revalidate: REVALIDATE },
  );
}

/** Switches vendor support access on or off and sets the longest grant. Off by default. */
export async function saveSupportSetting(input: SupportSettingInput): Promise<ActionResult<SupportSettingSaved>> {
  return runAction(
    async (ctx) => {
      const saved = await updateSupportAccessSetting(ctx, pickFields(input, ['enabled', 'max_duration_hours']));
      return { enabled: saved.enabled, maxHours: saved.max_duration_hours } satisfies SupportSettingSaved;
    },
    { revalidate: REVALIDATE },
  );
}

/** Grants vendor support access for a limited time, with a reason. It ends by itself. */
export async function grantSupport(input: GrantInput): Promise<ActionResult<GrantSaved>> {
  return runAction(
    async (ctx) => {
      const fields = pickFields(input, ['hours', 'reason']);
      const granted = await grantSupportAccess(ctx, fields);
      return { hours: typeof fields.hours === 'number' ? fields.hours : Math.round((Date.parse(granted.ended_at ?? granted.started_at) - Date.parse(granted.started_at)) / 3_600_000) } satisfies GrantSaved;
    },
    { revalidate: REVALIDATE },
  );
}

/** Ends an open support access now. */
export async function endSupport(input: GrantTarget): Promise<ActionResult<{ readonly ended: true }>> {
  return runAction(
    async (ctx) => {
      await endSupportAccess(ctx, pickText(input, 'grantId') ?? '');
      return { ended: true } as const;
    },
    { revalidate: REVALIDATE },
  );
}
