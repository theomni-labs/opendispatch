// SPDX-License-Identifier: AGPL-3.0-only
// Reference and admin data as contract records: users, roles, settings, shift patterns, break rules, classification rules,
// approvals, holidays, Hijri months, prayer times, model versions, notification rules and integrations. Node-free
// except calendar.ts (adhan through createRequire), so this module is generator-only.

import { calibration } from './calibration';
import { clock, hijriMonthsOfYear, holidaysOfYear, prayerTimesFor } from './calendar';
import { base, idOf, type Ctx, type Rec } from './context';
import { dateRange, iso, parseIso } from './time';
import { SHIFT_DEFS, type ShiftDef } from './people';

// ---------------------------------------------------------------------------------------------------------------------
// Users and role mappings
// ---------------------------------------------------------------------------------------------------------------------

export type RoleId = 'administrator' | 'dispatch_supervisor' | 'dispatcher' | 'planner' | 'remote_team_lead' | 'viewer_auditor' | 'change_approver';

export interface UserFx {
  readonly key: string;
  readonly id: string;
  readonly role: RoleId;
  readonly displayName: string;
  readonly record: Rec;
}

/** Invented people. Nothing here is a real person; the family names are made up from syllables. */
const USER_DEFS: { key: string; name: string; role: RoleId; zones: string[]; status: 'active' | 'invited' | 'disabled'; emergency?: boolean; locale: 'ar' | 'en' }[] = [
  { key: 'administrator', name: 'Nadia Al-Ghalani', role: 'administrator', zones: [], status: 'active', locale: 'en' },
  { key: 'dispatch_supervisor', name: 'Fahad Al-Musari', role: 'dispatch_supervisor', zones: ['RD-C', 'RD-N', 'RD-E', 'RD-S', 'RD-W'], status: 'active', locale: 'en' },
  { key: 'dispatcher', name: 'Omar Al-Fadani', role: 'dispatcher', zones: ['RD-C', 'RD-N'], status: 'active', locale: 'ar' },
  { key: 'planner', name: 'Reem Al-Hinari', role: 'planner', zones: ['RD-C', 'RD-N', 'RD-E'], status: 'active', locale: 'en' },
  { key: 'remote_team_lead', name: 'Maha Al-Khayani', role: 'remote_team_lead', zones: [], status: 'active', locale: 'en' },
  { key: 'viewer_auditor', name: 'Tariq Al-Dubari', role: 'viewer_auditor', zones: [], status: 'active', locale: 'en' },
  { key: 'change_approver', name: 'Saad Al-Nabari', role: 'change_approver', zones: [], status: 'active', locale: 'en' },
  { key: 'emergency_admin', name: 'Emergency Administrator', role: 'administrator', zones: [], status: 'active', emergency: true, locale: 'en' },
  { key: 'supervisor_west', name: 'Hala Al-Fadani', role: 'dispatch_supervisor', zones: ['JD-N', 'JD-S', 'DM-C'], status: 'active', locale: 'ar' },
  { key: 'dispatcher_west', name: 'Lama Al-Ghalani', role: 'dispatcher', zones: ['JD-N', 'JD-S'], status: 'active', locale: 'ar' },
  { key: 'planner_west', name: 'Yousef Al-Musari', role: 'planner', zones: ['JD-N', 'JD-S', 'DM-C'], status: 'active', locale: 'en' },
  { key: 'planner_invited', name: 'Adel Al-Hinari', role: 'planner', zones: ['RD-S'], status: 'invited', locale: 'en' },
  { key: 'dispatcher_disabled', name: 'Ziyad Al-Khayani', role: 'dispatcher', zones: ['RD-W'], status: 'disabled', locale: 'en' },
];

function emailFor(name: string, emergency: boolean): string {
  if (emergency) return 'emergency.admin@demo.example';
  return `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@demo.example`.replace(/\.+@/, '@');
}

export function buildUsers(ctx: Ctx): UserFx[] {
  const zoneId = (code: string): string => idOf(ctx, 'zone', code);
  return USER_DEFS.map((u, i) => {
    const id = idOf(ctx, 'user', u.key);
    const created = ctx.seededAt - (30 - i) * 86400;
    const signedIn = u.status === 'active' ? parseIso('2026-09-12T08:00:00+03:00') + i * 1800 : null;
    const record: Rec = {
      ...base(ctx, 'user', u.key, created, created),
      keycloak_subject: null,
      email: emailFor(u.name, u.emergency === true),
      display_name: u.name,
      assigned_role: u.role,
      zone_ids: u.zones.map(zoneId),
      status: u.status,
      is_emergency_admin: u.emergency === true,
      last_sign_in_at: signedIn === null ? null : iso(signedIn),
      preferred_locale: u.locale,
    };
    return { key: u.key, id, role: u.role, displayName: u.name, record };
  });
}

export function userByKey(users: readonly UserFx[], key: string): UserFx {
  const u = users.find((x) => x.key === key);
  if (u === undefined) throw new Error(`No demo user ${key}`);
  return u;
}

/** Group to role and zones. Group ids look like Entra object ids (invented). */
export function buildRoleMappings(ctx: Ctx): Rec[] {
  const zoneId = (code: string): string => idOf(ctx, 'zone', code);
  const defs: { key: string; group: string; type: 'exact' | 'object_id' | 'prefix'; role: RoleId; zones: string[]; priority: number; enabled: boolean }[] = [
    { key: 'admins', group: 'opendispatch-administrators', type: 'exact', role: 'administrator', zones: [], priority: 1, enabled: true },
    { key: 'sup_riyadh', group: '5b1d0c1e-3a44-4f0b-9d25-7f1c3e8a2b01', type: 'object_id', role: 'dispatch_supervisor', zones: ['RD-C', 'RD-N', 'RD-E', 'RD-S', 'RD-W'], priority: 2, enabled: true },
    { key: 'sup_west', group: '5b1d0c1e-3a44-4f0b-9d25-7f1c3e8a2b02', type: 'object_id', role: 'dispatch_supervisor', zones: ['JD-N', 'JD-S', 'DM-C'], priority: 3, enabled: true },
    { key: 'disp_riyadh_core', group: 'opendispatch-dispatch-riyadh-core', type: 'exact', role: 'dispatcher', zones: ['RD-C', 'RD-N'], priority: 4, enabled: true },
    { key: 'disp_jeddah', group: 'opendispatch-dispatch-jeddah', type: 'exact', role: 'dispatcher', zones: ['JD-N', 'JD-S'], priority: 5, enabled: true },
    { key: 'planners_riyadh', group: 'opendispatch-planners-riyadh', type: 'exact', role: 'planner', zones: ['RD-C', 'RD-N', 'RD-E'], priority: 6, enabled: true },
    { key: 'planners_west', group: 'opendispatch-planners-west', type: 'exact', role: 'planner', zones: ['JD-N', 'JD-S', 'DM-C'], priority: 7, enabled: true },
    { key: 'remote_leads', group: 'opendispatch-remote-team-leads', type: 'exact', role: 'remote_team_lead', zones: [], priority: 8, enabled: true },
    { key: 'auditors', group: 'opendispatch-auditors', type: 'exact', role: 'viewer_auditor', zones: [], priority: 9, enabled: true },
    { key: 'change_managers', group: 'opendispatch-change-approvers', type: 'prefix', role: 'change_approver', zones: [], priority: 10, enabled: true },
    { key: 'legacy_planners', group: 'opendispatch-legacy-planners', type: 'exact', role: 'planner', zones: ['RD-S', 'RD-W'], priority: 11, enabled: false },
  ];
  return defs.map((d) => ({
    ...base(ctx, 'role_mapping', d.key, ctx.seededAt - 20 * 86400),
    identity_provider_id: null,
    group_match: d.group,
    group_match_type: d.type,
    assigned_role: d.role,
    zone_ids: d.zones.map(zoneId),
    priority: d.priority,
    is_enabled: d.enabled,
  }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Settings (key and value records; typed views are assembled by the data layer into SettingsSnapshot)
// ---------------------------------------------------------------------------------------------------------------------

export function settingKeyForZoneStage(code: string): string {
  return `live_assignment.stage.${code.toLowerCase().replace(/-/g, '_')}`;
}

export function buildSettings(ctx: Ctx, adminId: string): Rec[] {
  const rs = calibration.roles_and_settings;
  const at = ctx.seededAt - 10 * 86400;
  const rows: { key: string; value: unknown }[] = [
    { key: 'clock_start', value: rs.ten_minute_clock_start.value },
    { key: 'planning_level', value: rs.planning_level.value },
    { key: 'fallback_timeout_seconds', value: rs.fallback_timeout_seconds.value },
    { key: 'decision_deadline_ms', value: 2000 },
    { key: 'ten_minute_threshold_seconds', value: rs.assignment_ten_minute_threshold_seconds.value },
    { key: 'install_mode', value: 'private' },
    { key: 'localization', value: { default_locale: 'en', digit_system: 'western', primary_calendar: 'gregorian', show_secondary_calendar: true, time_zone: 'Asia/Riyadh', first_day_of_week: 'sunday' } },
    { key: 'auth.local_users_for_outsiders', value: rs.local_users_for_outsiders.value },
    { key: 'auth.require_mfa_claim', value: false },
    { key: 'support_access.enabled', value: rs.support_access_enabled.value },
    { key: 'skills.vocabulary', value: calibration.people.skills_vocabulary.value.map((s) => ({ code: s.code, name_en: s.name_en, name_ar: s.name_ar })) },
    { key: 'override.reason_codes', value: rs.override_reason_codes.value.map((r) => ({ code: r.code, name_en: r.name_en, name_ar: null, requires_note: r.requires_note })) },
    { key: 'classification.precedence', value: ['field_mandatory', 'field_preferred', 'remote_eligible'] },
    { key: 'classification.default_outcome', value: 'field_preferred' },
    { key: 'demo.today', value: ctx.demoToday },
  ];
  const stageChangedAt: Record<string, string> = { 'RD-C': '2026-09-09T10:15:00+03:00', 'RD-N': '2026-09-09T10:16:00+03:00' };
  const updatedAt = new Map<string, number>();
  for (const zone of ctx.world.locations.zones) {
    const key = settingKeyForZoneStage(zone.code);
    const changed = stageChangedAt[zone.code];
    const when = changed === undefined ? at : parseIso(changed);
    updatedAt.set(key, when);
    rows.push({ key, value: { zone_id: zone.id, stage: zone.live_stage, updated_at: iso(when), updated_by: adminId, data_source: 'SYNTHETIC' } });
  }
  return rows.map((r) => ({ ...base(ctx, 'setting', r.key, at, updatedAt.get(r.key) ?? at, adminId), key: r.key, value: r.value }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Shift patterns and break rules
// ---------------------------------------------------------------------------------------------------------------------

export function shiftPatternId(ctx: Ctx, key: string): string {
  return idOf(ctx, 'shift_pattern', key);
}

export function breakRuleId(ctx: Ctx, code: string): string {
  return idOf(ctx, 'break_rule', code);
}

export function buildBreakRules(ctx: Ctx): Rec[] {
  const rules = [
    { code: 'BRK-STD', name: 'Standard: 30 minutes after 5 consecutive hours' },
    { code: 'BRK-RAM', name: 'Ramadan hours: 30 minutes after 5 consecutive hours' },
  ];
  return rules.map((r) => ({
    ...base(ctx, 'break_rule', r.code, ctx.seededAt),
    code: r.code,
    name_en: r.name,
    name_ar: null,
    break_minutes: 30,
    after_consecutive_hours: 5,
  }));
}

function hours(applies: boolean, range: readonly [string, string] | null): Rec {
  if (!applies || range === null) return { applies: false };
  const [start, end] = range;
  // "00:00" as an end time means midnight and does not count as crossing it (contract, LocalTime).
  const crosses = end !== '00:00' && end <= start;
  return { applies: true, start_time: start, end_time: end, crosses_midnight: crosses };
}

export function buildShiftPatterns(ctx: Ctx): Rec[] {
  return SHIFT_DEFS.map((d: ShiftDef) => ({
    ...base(ctx, 'shift_pattern', d.key, ctx.seededAt),
    code: d.key.toUpperCase().replace(/_/g, '-'),
    name_en: d.name_en,
    name_ar: d.name_ar,
    kind: d.kind,
    normal: hours(d.normal !== null, d.normal),
    ramadan: hours(true, d.ramadan),
    break_rule_id: breakRuleId(ctx, 'BRK-STD'),
    status: 'active',
    extra: { assumption: true, note: 'All shift times are assumptions (plan Appendix C).' },
  }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Classification rules, versions and approvals
// ---------------------------------------------------------------------------------------------------------------------

type Outcome = 'remote_eligible' | 'field_mandatory' | 'field_preferred';
type Operator = 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'in';

interface RuleDef {
  readonly code: string;
  readonly name: string;
  /** Arabic name (draft, for native review). */
  readonly nameAr: string;
  readonly outcome: Outcome;
  readonly status: 'active' | 'draft';
  readonly match: 'all' | 'any';
  readonly predicates: readonly { field: string; operator: Operator; value: string | number | boolean }[];
  readonly text: string;
  readonly source: string;
}

/** the role matrix, "Classification rules", word for word where it fits a field. Draft markings kept. */
export const RULE_DEFS: readonly RuleDef[] = [
  {
    code: 'RULE-001',
    name: 'Simple case: remote eligible',
    nameAr: 'بلاغ بسيط: مؤهل عن بُعد',
    outcome: 'remote_eligible',
    status: 'active',
    match: 'all',
    predicates: [
      { field: 'injury_present', operator: 'eq', value: false },
      { field: 'insured_party_count', operator: 'eq', value: 1 },
      { field: 'estimated_damage_sar', operator: 'lt', value: 10000 },
      { field: 'multi_vehicle', operator: 'eq', value: false },
      { field: 'pedestrian_involved', operator: 'eq', value: false },
    ],
    text: 'No injury, one insured party, damage under SAR 10,000, not multi-vehicle or pedestrian',
    source: "Public descriptions of the customer's remote review. Can't run on current real data (no injury or damage fields)",
  },
  { code: 'RULE-002', name: 'Injury: field mandatory', nameAr: 'إصابة: ميداني إلزامي', outcome: 'field_mandatory', status: 'active', match: 'all', predicates: [{ field: 'injury_present', operator: 'eq', value: true }], text: 'Injury present, any severity', source: "Same. Can't run on current real data" },
  { code: 'RULE-003', name: 'Three parties: field preferred', nameAr: 'ثلاثة أطراف: ميداني مفضّل', outcome: 'field_preferred', status: 'draft', match: 'all', predicates: [{ field: 'parties_involved', operator: 'eq', value: 3 }], text: 'Three parties', source: 'Our assumption' },
  { code: 'RULE-003A', name: 'Four or more parties: field mandatory', nameAr: 'أربعة أطراف أو أكثر: ميداني إلزامي', outcome: 'field_mandatory', status: 'draft', match: 'all', predicates: [{ field: 'parties_involved', operator: 'gte', value: 4 }], text: 'Four or more parties', source: 'Our assumption' },
  { code: 'RULE-004', name: 'Pedestrian: field mandatory', nameAr: 'وجود مشاة: ميداني إلزامي', outcome: 'field_mandatory', status: 'active', match: 'all', predicates: [{ field: 'pedestrian_involved', operator: 'eq', value: true }], text: 'Pedestrian involved', source: "Public descriptions. Can't run on current real data" },
  { code: 'RULE-005', name: 'Damage SAR 10,000 or more: field mandatory', nameAr: 'ضرر 10,000 ريال أو أكثر: ميداني إلزامي', outcome: 'field_mandatory', status: 'active', match: 'all', predicates: [{ field: 'estimated_damage_sar', operator: 'gte', value: 10000 }], text: 'Damage estimate SAR 10,000 or above', source: "Same. Can't run on current real data" },
  { code: 'RULE-006', name: 'Highway or outside city: field preferred', nameAr: 'طريق سريع أو خارج المدينة: ميداني مفضّل', outcome: 'field_preferred', status: 'draft', match: 'all', predicates: [{ field: 'highway_or_outside_city_limits', operator: 'eq', value: true }], text: 'Highway or outside city limits', source: 'Our assumption; needs road data' },
  { code: 'RULE-007', name: 'Customer asks for field: field mandatory', nameAr: 'طلب العميل الحضور الميداني: ميداني إلزامي', outcome: 'field_mandatory', status: 'draft', match: 'all', predicates: [{ field: 'customer_requests_field_attendance', operator: 'eq', value: true }], text: 'Customer asks for field attendance', source: 'Our assumption' },
  { code: 'RULE-008', name: 'Unlisted: field mandatory', nameAr: 'بلاغ Unlisted: ميداني إلزامي', outcome: 'field_mandatory', status: 'draft', match: 'all', predicates: [{ field: 'case_type', operator: 'eq', value: 'Unlisted' }], text: 'Case type Unlisted', source: 'Our assumption' },
  { code: 'RULE-009', name: 'Police attended: field preferred', nameAr: 'بحضور الشرطة: ميداني مفضّل', outcome: 'field_preferred', status: 'draft', match: 'all', predicates: [{ field: 'case_type', operator: 'eq', value: 'Police attended' }], text: 'Case type Police attended', source: 'Our assumption' },
];

export function ruleId(ctx: Ctx, code: string): string {
  return idOf(ctx, 'classification_rule', code);
}

export function ruleVersionId(ctx: Ctx, code: string, version: number): string {
  return idOf(ctx, 'rule_version', `${code}|${version}`);
}

export interface RuleFx {
  readonly rules: Rec[];
  readonly versions: Rec[];
  readonly approvals: Rec[];
}

/**
 * Rules, one version each. Active rules carry an approved version decided by the Dispatch Supervisor; Draft rules stay
 * drafts (status draft, no active version), as the role matrix marks them.
 */
export function buildRules(ctx: Ctx, adminId: string, supervisorId: string): RuleFx {
  const rules: Rec[] = [];
  const versions: Rec[] = [];
  const approvals: Rec[] = [];
  const effectiveFrom = '2026-08-01';
  const submittedAt = parseIso('2026-07-27T10:00:00+03:00');
  const decidedAt = parseIso('2026-07-28T09:30:00+03:00');
  RULE_DEFS.forEach((d, i) => {
    const active = d.status === 'active';
    const id = ruleId(ctx, d.code);
    rules.push({
      ...base(ctx, 'classification_rule', d.code, ctx.seededAt - 40 * 86400, active ? decidedAt : ctx.seededAt - 40 * 86400, adminId),
      rule_code: d.code,
      name_en: d.name,
      name_ar: d.nameAr,
      status: d.status,
      active_version: active ? 1 : null,
      source_note: d.source,
    });
    const vId = ruleVersionId(ctx, d.code, 1);
    versions.push({
      ...base(ctx, 'rule_version', `${d.code}|1`, ctx.seededAt - 40 * 86400, active ? decidedAt : ctx.seededAt - 40 * 86400, adminId),
      rule_id: id,
      rule_code: d.code,
      version: 1,
      condition: { match: d.match, predicates: d.predicates.map((p) => ({ field: p.field, operator: p.operator, value: p.value })) },
      condition_text_en: d.text,
      outcome: d.outcome,
      status: active ? 'active' : 'draft',
      effective_from: active ? effectiveFrom : null,
      effective_to: null,
      submitted_at: active ? iso(submittedAt) : null,
      decided_at: active ? iso(decidedAt) : null,
      decided_by_user_id: active ? supervisorId : null,
      decision_note: active ? 'Approved for the pilot rule set.' : null,
    });
    if (active) {
      approvals.push({
        ...base(ctx, 'approval', `rule|${d.code}|1`, submittedAt + i * 60, decidedAt, adminId),
        subject_type: 'rule_version',
        subject_id: vId,
        status: 'approved',
        summary_en: `${d.code} version 1: ${d.text} gives ${d.outcome.replace(/_/g, ' ')}`,
        requested_at: iso(submittedAt),
        decided_at: iso(decidedAt),
        decided_by_user_id: supervisorId,
        decision_note: 'Approved for the pilot rule set.',
      });
    }
  });
  return { rules, versions, approvals };
}

// ---------------------------------------------------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------------------------------------------------

export function buildHolidays(ctx: Ctx): Rec[] {
  const year = calibration.calendar.year.value;
  return holidaysOfYear(year).map((h) => ({
    ...base(ctx, 'holiday', `${year}|${h.key}`, ctx.seededAt),
    name_en: h.name_en,
    name_ar: h.name_ar,
    start_date: h.start_date,
    end_date: h.end_date,
    kind: h.kind,
    hijri_start: h.hijri_start,
    hijri_end: h.hijri_end,
  }));
}

export function buildHijriMonths(ctx: Ctx): Rec[] {
  const year = calibration.calendar.year.value;
  return hijriMonthsOfYear(year).map((m) => ({
    ...base(ctx, 'hijri_month', `${m.hijri_year}|${m.hijri_month}`, ctx.seededAt),
    hijri_year: m.hijri_year,
    hijri_month: m.hijri_month,
    name_en: m.name_en,
    name_ar: m.name_ar,
    gregorian_start: m.starts_on,
    gregorian_end: m.ends_on,
    is_ramadan: m.is_ramadan,
  }));
}

/** Prayer times for the three cities on the case week, computed with adhan (Umm al-Qura), rounded to the minute. */
export function buildPrayerTimes(ctx: Ctx): Rec[] {
  const out: Rec[] = [];
  for (const city of ctx.world.locations.cities) {
    for (const date of dateRange(ctx.firstCaseDay, ctx.lastCaseDay)) {
      const p = prayerTimesFor(city, date);
      out.push({
        ...base(ctx, 'prayer_time', `${city.code}|${date}`, ctx.seededAt),
        city_id: city.id,
        prayer_date: date,
        fajr: clock(p.fajr),
        sunrise: clock(p.sunrise),
        dhuhr: clock(p.dhuhr),
        asr: clock(p.asr),
        maghrib: clock(p.maghrib),
        isha: clock(p.isha),
        calculation_method: 'umm_al_qura',
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Model versions, notification rules, integrations
// ---------------------------------------------------------------------------------------------------------------------

export function buildModelVersions(ctx: Ctx, adminId: string): Rec[] {
  // The real forecaster's models (engines registry)
  const defs = [
    { version: 'ensemble-3', status: 'retired', trained: '2026-08-20T02:00:00+03:00', notes: 'Previous forecaster champion. Kept to switch back to.' },
    { version: 'ensemble-4', status: 'active', trained: '2026-09-01T02:00:00+03:00', notes: 'Forecaster champion. On synthetic data every figure is Illustrative.' },
  ];
  return defs.map((d) => ({
    ...base(ctx, 'model_version', d.version, parseIso(d.trained), parseIso(d.trained), adminId),
    version: d.version,
    status: d.status,
    is_placeholder: false,
    engine_version: '0.6.0',
    trained_at: d.trained,
    notes_en: d.notes,
  }));
}

export function buildNotificationRules(ctx: Ctx, adminId: string): Rec[] {
  type R = 'administrator' | 'dispatch_supervisor' | 'dispatcher' | 'planner' | 'remote_team_lead' | 'viewer_auditor' | 'change_approver';
  const defs: { event: string; channels: string[]; roles: R[]; severity: 'info' | 'warning' | 'critical' }[] = [
    { event: 'model_paused', channels: ['in_app', 'email'], roles: ['administrator', 'planner'], severity: 'warning' },
    { event: 'model_switched', channels: ['in_app'], roles: ['administrator', 'planner'], severity: 'info' },
    { event: 'model_degraded', channels: ['in_app'], roles: ['administrator', 'planner'], severity: 'warning' },
    { event: 'rule_approved', channels: ['in_app'], roles: ['administrator', 'planner'], severity: 'info' },
    { event: 'rule_rejected', channels: ['in_app'], roles: ['administrator'], severity: 'info' },
    { event: 'roster_approved', channels: ['in_app'], roles: ['planner', 'dispatch_supervisor'], severity: 'info' },
    { event: 'override_created', channels: ['in_app'], roles: ['dispatch_supervisor'], severity: 'info' },
    { event: 'leave_decided', channels: ['in_app'], roles: ['planner'], severity: 'info' },
    { event: 'import_failed', channels: ['in_app', 'email'], roles: ['administrator'], severity: 'warning' },
    { event: 'integration_down', channels: ['in_app', 'email'], roles: ['administrator', 'dispatch_supervisor'], severity: 'critical' },
    { event: 'fallback_active', channels: ['in_app', 'email'], roles: ['administrator', 'dispatch_supervisor', 'dispatcher'], severity: 'critical' },
    { event: 'emergency_admin_sign_in', channels: ['in_app', 'email'], roles: ['administrator', 'viewer_auditor'], severity: 'critical' },
    { event: 'update_ready', channels: ['in_app'], roles: ['administrator', 'change_approver'], severity: 'info' },
    { event: 'update_failed', channels: ['in_app', 'email'], roles: ['administrator', 'change_approver'], severity: 'critical' },
    { event: 'backup_overdue', channels: ['in_app', 'email'], roles: ['administrator'], severity: 'warning' },
    { event: 'case_unreachable', channels: ['in_app'], roles: ['dispatch_supervisor'], severity: 'warning' },
  ];
  return defs.map((d) => ({
    ...base(ctx, 'notification_rule', d.event, ctx.seededAt, ctx.seededAt, adminId),
    event_type: d.event,
    channels: d.channels,
    recipient_roles: d.roles,
    severity: d.severity,
    is_enabled: true,
  }));
}

export function buildIntegrations(ctx: Ctx, adminId: string): Rec[] {
  const ok = iso(ctx.demoNow - 40);
  const defs: { key: string; kind: string; name: string; direction: 'inbound' | 'outbound'; enabled: boolean; label: string | null; health: string; lastOk: string | null; lastErr: string | null; errMsg: string | null; timeout: number | null }[] = [
    { key: 'case_feed', kind: 'case_feed', name: 'Operator case feed (simulator)', direction: 'inbound', enabled: true, label: 'Simulated feed, no real endpoint', health: 'healthy', lastOk: ok, lastErr: null, errMsg: null, timeout: null },
    { key: 'agent_feed', kind: 'agent_feed', name: 'Agent status and location feed (simulator)', direction: 'inbound', enabled: true, label: 'Simulated feed, no real endpoint', health: 'degraded', lastOk: iso(ctx.demoNow - 5 * 60), lastErr: iso(ctx.demoNow - 3 * 60), errMsg: 'Position updates delayed by more than 60 seconds for 4 agents.', timeout: null },
    { key: 'assignment_channel', kind: 'assignment_channel', name: "Assignment channel to the customer's agent app (simulator)", direction: 'outbound', enabled: true, label: 'Simulated channel, no real endpoint', health: 'healthy', lastOk: ok, lastErr: null, errMsg: null, timeout: calibration.roles_and_settings.fallback_timeout_seconds.value },
    { key: 'weather_feed', kind: 'weather_feed', name: 'Weather feed', direction: 'inbound', enabled: false, label: null, health: 'disabled', lastOk: null, lastErr: null, errMsg: null, timeout: null },
    { key: 'routing_feed', kind: 'routing_feed', name: 'Road routing service', direction: 'inbound', enabled: false, label: null, health: 'disabled', lastOk: null, lastErr: null, errMsg: null, timeout: null },
  ];
  return defs.map((d) => ({
    ...base(ctx, 'integration', d.key, ctx.seededAt - 15 * 86400, ctx.demoNow - 60, adminId),
    kind: d.kind,
    name_en: d.name,
    direction: d.direction,
    is_enabled: d.enabled,
    endpoint_label: d.label,
    credential_ref: d.enabled ? `secret://opendispatch/${d.key}` : null,
    health: d.health,
    last_success_at: d.lastOk,
    last_error_at: d.lastErr,
    last_error_message: d.errMsg,
    fallback_timeout_seconds: d.timeout,
  }));
}

