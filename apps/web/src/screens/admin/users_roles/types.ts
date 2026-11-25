// SPDX-License-Identifier: AGPL-3.0-only
// The plain data of the Users and Roles screen: what the server side hands to the client files.
// Everything here is JSON-safe (strings, numbers, booleans, arrays and objects of those), so it can cross from the Server
// Component to the tables and forms. Nothing here is a context, a customer or the caller's role.

import type { ApprovalKind, InstallMode, ModuleId, Role, ScopeKind } from '@/lib/access';

export type UserStatus = 'invited' | 'active' | 'disabled';

/** Why "Disable user" is not available for a row (the data layer refuses both; the screen says so first, in the reader's language). */
export type DisableBlock = 'self' | 'lastAdmin';

/** One person, as the list and the drawer need them. */
export interface UserRow {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  /** The assigned role of the listed person (not the caller's). */
  readonly assignedRole: Role;
  readonly status: UserStatus;
  readonly emergency: boolean;
  readonly scope: ScopeKind;
  readonly zoneIds: readonly string[];
  readonly zoneCodes: readonly string[];
  /** ISO 8601, or null when the person has never signed in. */
  readonly lastSignIn: string | null;
  readonly language: 'en' | 'ar';
  readonly disableBlock: DisableBlock | null;
}

/** What a role can do in an install mode, grouped as the mockup's "Effective access" card shows it. */
export interface AccessSummary {
  readonly edit: readonly ModuleId[];
  readonly view: readonly ModuleId[];
  readonly approve: readonly ApprovalKind[];
  /** Modules the role does not see at all. */
  readonly hidden: number;
}

/** One cell of the access matrix: the level, and whether the role also approves in that module. */
export interface MatrixCell {
  readonly access: 'edit' | 'view' | 'none';
  readonly approve: boolean;
}

/** The matrix of one install mode: the roles that exist in it, and every role's cell for every module. */
export interface ModeMatrix {
  readonly roles: readonly Role[];
  readonly cells: Readonly<Record<string, Readonly<Record<string, MatrixCell>>>>;
  /** The effective access of each role in this mode, for the "Effective access" card. */
  readonly summary: Readonly<Record<string, AccessSummary>>;
}

export interface RoleOption {
  readonly role: Role;
  readonly scope: ScopeKind;
  /** False when the role does not exist in this install mode (Change Approver outside private installs). */
  readonly availableHere: boolean;
}

export type Matrices = Readonly<Record<InstallMode, ModeMatrix>>;

// ---------------------------------------------------------------------------------------------
// What the browser sends to the actions (actions.ts). The scanner of tools/rules/context-rules.test.ts reads these types:
// no field here is a context, customer, user, role, zone scope or install mode. The role a person is given is
// `assigned_role`; the person an action acts on is `targetUserId`.
// ---------------------------------------------------------------------------------------------

export interface InviteUserInput {
  readonly email: string;
  readonly display_name: string;
  readonly assigned_role: string;
  readonly zone_ids: readonly string[];
}

export interface UpdateUserInput {
  readonly targetUserId: string;
  readonly display_name: string;
  readonly assigned_role: string;
  readonly zone_ids: readonly string[];
}

export interface UserTarget {
  readonly targetUserId: string;
}

export interface UserTargets {
  readonly targetUserIds: readonly string[];
}

/** What an action gives back about the person it changed: enough for a toast, nothing private. */
export interface UserSummary {
  readonly id: string;
  readonly name: string;
  readonly assignedRole: string;
  readonly status: string;
}

export interface BulkDisableResult {
  readonly disabled: number;
  readonly failed: number;
  /** The data layer's English message for the first person it refused. */
  readonly firstProblem?: string;
}

export interface ResetResult {
  /** The last characters of the temporary secret, as the data layer returns them. */
  readonly hint: string;
}
