// SPDX-License-Identifier: AGPL-3.0-only
// The message loader. SERVER ONLY: this file holds every module's messages, so no
// client file may import it (messages-loader.test.ts checks). Client code gets messages as props from a layout.
//
//   messages/{en,ar}.json                 core: everything that is not one module's (nav, shell, states, ds, opendispatch,...)
//   messages/admin/<module>/{en,ar}.json  one Admin module's screen text; <module> is the module id after `admin.`
//   messages/ops/<module>/{en,ar}.json
//     one Ops module's screen text; built
//     per build step. OPS is a Partial: a
//     module with no file gets core only.
//
// A module file is laid into the tree at
// `admin.<module>` or `ops.<module>`, its module id,
// so a screen writes `useTranslations('ops.x')` and
// files carry no prefix. `admin` and `ops` are
// reserved: core has no top-level `admin`/`ops` key.
//
//   server (request.ts)
//     core + every module; getTranslations
//     ('<console>.<module>') works anywhere.
//   client, any page (root layout)
//     core only
//   client, /{locale}/<console>/{module}
//     core + that module (ModuleMessages.tsx)
//
// The files are imported statically, so a missing module is a type error here, not a missing file at run time.

import { ADMIN_MODULE_IDS, type AdminModuleId, type OpsModuleId } from '@/lib/access';
import { customerShortName } from '@/lib/data/wording';
import { fillCustomer, type Messages, mergeMessages } from './message-tree';
import { locales, type Locale } from './routing';
import ar from '../../messages/ar.json';
import aiAssistantAr from '../../messages/admin/ai_assistant/ar.json';
import aiAssistantEn from '../../messages/admin/ai_assistant/en.json';
import en from '../../messages/en.json';
import apiWebhooksAr from '../../messages/admin/api_webhooks/ar.json';
import apiWebhooksEn from '../../messages/admin/api_webhooks/en.json';
import auditLogAr from '../../messages/admin/audit_log/ar.json';
import auditLogEn from '../../messages/admin/audit_log/en.json';
import classificationRulesAr from '../../messages/admin/classification_rules/ar.json';
import classificationRulesEn from '../../messages/admin/classification_rules/en.json';
import dataImportQualityAr from '../../messages/admin/data_import_quality/ar.json';
import dataImportQualityEn from '../../messages/admin/data_import_quality/en.json';
import dataSourcesAr from '../../messages/admin/data_sources/ar.json';
import dataSourcesEn from '../../messages/admin/data_sources/en.json';
import forecastModelAr from '../../messages/admin/forecast_model/ar.json';
import forecastModelEn from '../../messages/admin/forecast_model/en.json';
import leavePolicyCalendarAr from '../../messages/admin/leave_policy_calendar/ar.json';
import leavePolicyCalendarEn from '../../messages/admin/leave_policy_calendar/en.json';
import localizationAr from '../../messages/admin/localization/ar.json';
import localizationEn from '../../messages/admin/localization/en.json';
import locationsAr from '../../messages/admin/locations/ar.json';
import locationsEn from '../../messages/admin/locations/en.json';
import notificationsAlertsAr from '../../messages/admin/notifications_alerts/ar.json';
import notificationsAlertsEn from '../../messages/admin/notifications_alerts/en.json';
import securityComplianceAr from '../../messages/admin/security_compliance/ar.json';
import securityComplianceEn from '../../messages/admin/security_compliance/en.json';
import shiftBreakPoliciesAr from '../../messages/admin/shift_break_policies/ar.json';
import shiftBreakPoliciesEn from '../../messages/admin/shift_break_policies/en.json';
import signInIdentityAr from '../../messages/admin/sign_in_identity/ar.json';
import signInIdentityEn from '../../messages/admin/sign_in_identity/en.json';
import agentsVehiclesAr from '../../messages/admin/agents_vehicles/ar.json';
import agentsVehiclesEn from '../../messages/admin/agents_vehicles/en.json';
import systemHealthAr from '../../messages/admin/system_health/ar.json';
import systemHealthEn from '../../messages/admin/system_health/en.json';
import updatesAr from '../../messages/admin/updates/ar.json';
import updatesEn from '../../messages/admin/updates/en.json';
import usersRolesAr from '../../messages/admin/users_roles/ar.json';
import usersRolesEn from '../../messages/admin/users_roles/en.json';
import breakPlannerAr from '../../messages/ops/break_planner/ar.json';
import breakPlannerEn from '../../messages/ops/break_planner/en.json';
import fieldPlannerAr from '../../messages/ops/field_planner/ar.json';
import fieldPlannerEn from '../../messages/ops/field_planner/en.json';
import forecastExplorerAr from '../../messages/ops/forecast_explorer/ar.json';
import forecastExplorerEn from '../../messages/ops/forecast_explorer/en.json';
import gapSurplusAr from '../../messages/ops/gap_surplus/ar.json';
import gapSurplusEn from '../../messages/ops/gap_surplus/en.json';
import leavePlannerAr from '../../messages/ops/leave_planner/ar.json';
import leavePlannerEn from '../../messages/ops/leave_planner/en.json';
import liveDispatchBoardAr from '../../messages/ops/live_dispatch_board/ar.json';
import liveDispatchBoardEn from '../../messages/ops/live_dispatch_board/en.json';
import managementDashboardsAr from '../../messages/ops/management_dashboards/ar.json';
import managementDashboardsEn from '../../messages/ops/management_dashboards/en.json';
import productivityMetricsAr from '../../messages/ops/productivity_metrics/ar.json';
import productivityMetricsEn from '../../messages/ops/productivity_metrics/en.json';
import remoteQueueAr from '../../messages/ops/remote_queue/ar.json';
import remoteQueueEn from '../../messages/ops/remote_queue/en.json';
import scenarioLabAr from '../../messages/ops/scenario_lab/ar.json';
import scenarioLabEn from '../../messages/ops/scenario_lab/en.json';
import serviceLevelSimulatorAr from '../../messages/ops/service_level_simulator/ar.json';
import serviceLevelSimulatorEn from '../../messages/ops/service_level_simulator/en.json';
import standbyCoverageAr from '../../messages/ops/standby_coverage/ar.json';
import standbyCoverageEn from '../../messages/ops/standby_coverage/en.json';

export type { Messages } from './message-tree';

type StripConsole<T> = T extends `admin.${infer Key}` ? Key : never;
type StripOpsConsole<T> = T extends `ops.${infer Key}` ? Key : never;
/** The folder name of an Admin module under messages/admin: its id without `admin.`, for example `users_roles`. */
export type AdminModuleKey = StripConsole<AdminModuleId>;
/** The folder name of an Ops module under messages/ops: its id without `ops.`, for example `field_planner`. */
export type OpsModuleKey = StripOpsConsole<OpsModuleId>;

export const ADMIN_MODULE_KEYS: readonly AdminModuleKey[] = ADMIN_MODULE_IDS.map((id) => id.slice('admin.'.length) as AdminModuleKey);

const CORE: Readonly<Record<Locale, Messages>> = { en, ar };

// One line per module. `Record<AdminModuleKey,...>` makes the compiler refuse a missing or a misspelt module.
const ADMIN: Readonly<Record<AdminModuleKey, Readonly<Record<Locale, Messages>>>> = {
  users_roles: { en: usersRolesEn, ar: usersRolesAr },
  sign_in_identity: { en: signInIdentityEn, ar: signInIdentityAr },
  locations: { en: locationsEn, ar: locationsAr },
  agents_vehicles: { en: agentsVehiclesEn, ar: agentsVehiclesAr },
  classification_rules: { en: classificationRulesEn, ar: classificationRulesAr },
  shift_break_policies: { en: shiftBreakPoliciesEn, ar: shiftBreakPoliciesAr },
  leave_policy_calendar: { en: leavePolicyCalendarEn, ar: leavePolicyCalendarAr },
  forecast_model: { en: forecastModelEn, ar: forecastModelAr },
  data_sources: { en: dataSourcesEn, ar: dataSourcesAr },
  data_import_quality: { en: dataImportQualityEn, ar: dataImportQualityAr },
  audit_log: { en: auditLogEn, ar: auditLogAr },
  notifications_alerts: { en: notificationsAlertsEn, ar: notificationsAlertsAr },
  api_webhooks: { en: apiWebhooksEn, ar: apiWebhooksAr },
  security_compliance: { en: securityComplianceEn, ar: securityComplianceAr },
  system_health: { en: systemHealthEn, ar: systemHealthAr },
  updates: { en: updatesEn, ar: updatesAr },
  localization: { en: localizationEn, ar: localizationAr },
  ai_assistant: { en: aiAssistantEn, ar: aiAssistantAr },
};

// Ops modules get files one at a time, so
// this is a Partial (unlike ADMIN): a module not
// listed here has no file yet and gets core only.
const OPS: Readonly<Partial<Record<OpsModuleKey, Readonly<Record<Locale, Messages>>>>> = {
  break_planner: { en: breakPlannerEn, ar: breakPlannerAr },
  field_planner: { en: fieldPlannerEn, ar: fieldPlannerAr },
  forecast_explorer: { en: forecastExplorerEn, ar: forecastExplorerAr },
  gap_surplus: { en: gapSurplusEn, ar: gapSurplusAr },
  leave_planner: { en: leavePlannerEn, ar: leavePlannerAr },
  live_dispatch_board: { en: liveDispatchBoardEn, ar: liveDispatchBoardAr },
  management_dashboards: { en: managementDashboardsEn, ar: managementDashboardsAr },
  productivity_metrics: { en: productivityMetricsEn, ar: productivityMetricsAr },
  remote_queue: { en: remoteQueueEn, ar: remoteQueueAr },
  scenario_lab: { en: scenarioLabEn, ar: scenarioLabAr },
  service_level_simulator: { en: serviceLevelSimulatorEn, ar: serviceLevelSimulatorAr },
  standby_coverage: { en: standbyCoverageEn, ar: standbyCoverageAr },
};

/** A locale the app serves, or the default one. Route params arrive as plain strings. */
function localeOf(value: string): Locale {
  return (locales as readonly string[]).includes(value) ? (value as Locale) : 'en';
}

/** `users_roles` for `admin.users_roles`; undefined for an Ops id, an unknown id or nothing. */
export function adminModuleKey(moduleId: string | undefined): AdminModuleKey | undefined {
  if (moduleId === undefined || !moduleId.startsWith('admin.')) return undefined;
  const key = moduleId.slice('admin.'.length);
  return (ADMIN_MODULE_KEYS as readonly string[]).includes(key) ? (key as AdminModuleKey) : undefined;
}

/**
 * The part of a message tree that is one module's: `{ admin: { <module>: files } }`. Empty for a module that has no
 * files (an Ops module, an unknown id, nothing). `modules` maps a folder name to that module's messages.
 */
export function sliceOf(modules: Readonly<Record<string, Messages>>, moduleId: string | undefined): Messages {
  if (moduleId === undefined || !moduleId.startsWith('admin.')) return {};
  const key = moduleId.slice('admin.'.length);
  const own = Object.hasOwn(modules, key) ? modules[key] : undefined;
  return own === undefined ? {} : { admin: { [key]: own } };
}

/** The Ops twin of sliceOf: `{ ops: { <module>: files } }`, empty for anything that is not `ops.<module>` with files. */
export function opsSliceOf(modules: Readonly<Record<string, Messages>>, moduleId: string | undefined): Messages {
  if (moduleId === undefined || !moduleId.startsWith('ops.')) return {};
  const key = moduleId.slice('ops.'.length);
  const own = Object.hasOwn(modules, key) ? modules[key] : undefined;
  return own === undefined ? {} : { ops: { [key]: own } };
}

const modulesOf = (locale: Locale): Record<string, Messages> =>
  Object.fromEntries(ADMIN_MODULE_KEYS.map((key) => [key, ADMIN[key][locale]]));

// Only Ops modules with a file today (OPS is a
// Partial), unlike modulesOf above.
const opsModulesOf = (locale: Locale): Record<string, Messages> =>
  Object.fromEntries(Object.entries(OPS).map(([key, byLocale]) => [key, (byLocale as Readonly<Record<Locale, Messages>>)[locale]]));

/** Core messages only: what every page's client gets (the root layout). */
export function coreMessages(locale: string): Messages {
  const loc = localeOf(locale);
  return named(`core:${loc}`, loc, () => CORE[loc]);
}

/** One module's messages laid at `admin.<module>` or `ops.<module>`; `{}` for a module id with no files. */
export function moduleMessages(locale: string, moduleId: string | undefined): Messages {
  const loc = localeOf(locale);
  if (moduleId?.startsWith('admin.') === true) return named(`${moduleId}:${loc}`, loc, () => sliceOf(modulesOf(loc), moduleId));
  if (moduleId?.startsWith('ops.') === true) return named(`${moduleId}:${loc}`, loc, () => opsSliceOf(opsModulesOf(loc), moduleId));
  return {};
}

/** What a page's client sees: core, plus the one module the route names. An unknown module gets core only. */
export function loadMessages(locale: string, moduleId?: string): Messages {
  return mergeMessages(coreMessages(locale), moduleMessages(locale, moduleId));
}

/**
 * What the server sees (the request config): core plus every Admin and Ops module that has files, so
 * `getTranslations('<console>.<module>')` works in any Server Component without the page saying which module it is.
 * It stays on the server: nothing here is sent to the browser except through `loadMessages` and the module layout.
 */
export function loadServerMessages(locale: string): Messages {
  const key = localeOf(locale);
  return named(`server:${key}`, key, () => mergeMessages(mergeMessages(CORE[key], { admin: modulesOf(key) }), { ops: opsModulesOf(key) }));
}

// Built once per tree and customer name
const FILLED = new Map<string, Messages>();

function named(id: string, locale: Locale, build: () => Messages): Messages {
  const name = customerShortName(locale);
  const key = `${id}|${name}`;
  let messages = FILLED.get(key);
  if (messages === undefined) {
    messages = fillCustomer(build(), name);
    // Unknown module ids stay out of the cache
    if (Object.keys(messages).length > 0) FILLED.set(key, messages);
  }
  return messages;
}
