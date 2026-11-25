// SPDX-License-Identifier: AGPL-3.0-only
// The server side of the Users and Roles screen: reads through lib/data with the request context and returns plain data
//. Not a Server Component and not an action: `Screen.tsx` calls it, and the tests call it directly.
//
// Reads: listUsers (q, status, assigned_role), listRoles, listZones and listCities (names for zones), getEffectiveAccess (the
// open person), previewEffectiveAccess (the Roles tab: every role in every install mode, computed here, so no role or
// install mode ever comes from the browser).

import { APPROVAL_MODULE, INSTALL_MODES, MODULES, ROLES, rolesForInstallMode, scopeAppliesTo, type ApprovalKind, type InstallMode, type ModuleId, type Role } from '@/lib/access';
import type { RequestContext } from '@/lib/data/guard';
import { listCities, listZones } from '@/lib/data/locations';
import { getEffectiveAccess, listRoles, listUsers, previewEffectiveAccess } from '@/lib/data/users';
import type { City, DataSource, ModuleAccess, PageInfo, User, Zone } from '@/lib/types';
import type { PickerZone } from '@/components/opendispatch/patterns/ZonePicker';
import type { AccessSummary, Matrices, MatrixCell, ModeMatrix, RoleOption, UserRow, UserStatus } from './types';

/** What the address bar may ask for (already validated by parseSearchParams). */
export interface UsersQuery {
  readonly q?: string | undefined;
  readonly role?: Role | undefined;
  readonly status?: UserStatus | undefined;
  /** A zone code such as RD-C, checked against the zones the caller can read. */
  readonly zone?: string | undefined;
  readonly id?: string | undefined;
}

export interface UsersView {
  readonly installMode: InstallMode;
  /** The data_source of every record shown. */
  readonly sources: readonly DataSource[];
  readonly total: number;
  readonly counts: { readonly active: number; readonly invited: number; readonly disabled: number };
  /** The people matching the search and filters. */
  readonly rows: readonly UserRow[];
  /** Number of people per assigned role, over everyone. */
  readonly roleCounts: Readonly<Record<string, number>>;
  readonly zones: readonly PickerZone[];
  readonly roleOptions: readonly RoleOption[];
  readonly matrices: Matrices;
  /** The person `?id=` opens, with what they can do; undefined when there is none or it does not exist. */
  readonly open: { readonly user: UserRow; readonly access: AccessSummary } | undefined;
  /** `?id=` named something that is not a person we can show: the screen says so above the list. */
  readonly unknownId: boolean;
  /** Whether an emergency administrator account exists (the header's reset items need one). */
  readonly hasEmergencyAdmin: boolean;
}

const PAGE = 200;

async function listAll<T>(fetch: (cursor: string | undefined) => { items: T[]; page: PageInfo } | Promise<{ items: T[]; page: PageInfo }>): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetch(cursor);
    out.push(...page.items);
    cursor = page.page.has_more ? (page.page.next_cursor ?? undefined) : undefined;
  } while (cursor !== undefined);
  return out;
}

/** The short code of a zone (`RD-C`), which the fixtures keep in `extra.code`; the name when a zone has none. */
export function zoneCode(zone: Zone): string {
  const code = zone.extra?.['code'];
  return typeof code === 'string' && code !== '' ? code : zone.name_en;
}

const KIND_BY_MODULE: ReadonlyMap<ModuleId, ApprovalKind> = new Map((Object.entries(APPROVAL_MODULE) as [ApprovalKind, ModuleId][]).map(([kind, module]) => [module, kind]));

/** Groups the per-module access of a role as the "Effective access" card does. */
export function summarise(modules: readonly ModuleAccess[]): AccessSummary {
  const known = new Set<string>(MODULES.map((m) => m.id));
  const listed = modules.filter((m): m is ModuleAccess & { module_id: ModuleId } => known.has(m.module_id));
  return {
    edit: listed.filter((m) => m.access === 'edit').map((m) => m.module_id),
    view: listed.filter((m) => m.access === 'view').map((m) => m.module_id),
    approve: listed.flatMap((m) => (m.can_approve && KIND_BY_MODULE.has(m.module_id) ? [KIND_BY_MODULE.get(m.module_id) as ApprovalKind] : [])),
    hidden: listed.filter((m) => m.access === 'none').length,
  };
}

async function matrixFor(ctx: RequestContext, mode: InstallMode): Promise<ModeMatrix> {
  const cells: Record<string, Record<string, MatrixCell>> = {};
  const summary: Record<string, AccessSummary> = {};
  for (const role of ROLES) {
    const preview = await previewEffectiveAccess(ctx, { assigned_role: role, install_mode: mode, zone_ids: [] });
    cells[role] = Object.fromEntries(preview.modules.map((m) => [m.module_id, { access: m.access, approve: m.can_approve } satisfies MatrixCell]));
    summary[role] = summarise(preview.modules);
  }
  return { roles: rolesForInstallMode(mode), cells, summary };
}

export async function loadUsersView(ctx: RequestContext, query: UsersQuery, rawId?: string | undefined): Promise<UsersView> {
  const everyone = await listAll((cursor) => listUsers(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const zones = await listAll((cursor) => listZones(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const cities = await listAll((cursor) => listCities(ctx, { limit: PAGE, ...(cursor === undefined ? {} : { cursor }) }));
  const roles = (await listRoles(ctx, { limit: PAGE })).items;

  const cityName = new Map<string, string>(cities.map((c: City) => [c.id, c.name_en]));
  const codeById = new Map<string, string>(zones.map((z) => [z.id, zoneCode(z)]));
  const zoneOptions: PickerZone[] = zones.map((z) => ({ id: z.id, code: zoneCode(z), name: z.name_en, cityId: z.city_id, cityName: cityName.get(z.city_id) ?? '' }));

  const administrators = everyone.filter((u) => u.assigned_role === 'administrator' && u.status !== 'disabled');
  const rowOf = (u: User): UserRow => {
    const lastAdmin = u.assigned_role === 'administrator' && u.status !== 'disabled' && administrators.length === 1 && administrators[0]?.id === u.id;
    return {
      id: u.id,
      name: u.display_name,
      email: u.email,
      assignedRole: u.assigned_role,
      status: u.status,
      emergency: u.is_emergency_admin,
      scope: scopeAppliesTo(u.assigned_role),
      zoneIds: [...u.zone_ids],
      zoneCodes: u.zone_ids.flatMap((id) => (codeById.has(id) ? [codeById.get(id) as string] : [])),
      lastSignIn: u.last_sign_in_at ?? null,
      language: u.preferred_locale === 'ar' ? 'ar' : 'en',
      disableBlock: u.id === ctx.userId ? 'self' : lastAdmin ? 'lastAdmin' : null,
    };
  };

  const matched = await listAll((cursor) =>
    listUsers(ctx, {
      limit: PAGE,
      ...(cursor === undefined ? {} : { cursor }),
      ...(query.q === undefined ? {} : { q: query.q }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.role === undefined ? {} : { assigned_role: query.role }),
    }),
  );
  const zoneId = query.zone === undefined ? undefined : zones.find((z) => zoneCode(z) === query.zone)?.id;
  const visible = matched.filter((u) => query.zone === undefined || (zoneId !== undefined && u.zone_ids.includes(zoneId)));

  const roleCounts: Record<string, number> = {};
  for (const u of everyone) roleCounts[u.assigned_role] = (roleCounts[u.assigned_role] ?? 0) + 1;

  const matrices = Object.fromEntries(await Promise.all(INSTALL_MODES.map(async (mode) => [mode, await matrixFor(ctx, mode)] as const))) as unknown as Matrices;

  const available = new Set(roles.map((r) => r.id));
  const roleOptions: RoleOption[] = ROLES.map((role) => ({ role, scope: scopeAppliesTo(role), availableHere: available.has(role) }));

  const target = query.id === undefined ? undefined : everyone.find((u) => u.id === query.id);
  const open = target === undefined ? undefined : { user: rowOf(target), access: summarise((await getEffectiveAccess(ctx, target.id)).modules) };
  const asked = rawId !== undefined && rawId !== '';

  return {
    installMode: ctx.installMode,
    sources: [...new Set(everyone.map((u) => u.data_source))],
    total: everyone.length,
    counts: {
      active: everyone.filter((u) => u.status === 'active').length,
      invited: everyone.filter((u) => u.status === 'invited').length,
      disabled: everyone.filter((u) => u.status === 'disabled').length,
    },
    rows: visible.map(rowOf),
    roleCounts,
    zones: zoneOptions,
    roleOptions,
    matrices,
    open,
    unknownId: asked && open === undefined,
    hasEmergencyAdmin: everyone.some((u) => u.is_emergency_admin),
  };
}
