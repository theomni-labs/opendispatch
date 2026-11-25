// SPDX-License-Identifier: AGPL-3.0-only
// Assembles every fixture file: what to write, under which schema. Generator-only (Node). The manifest the data layer
// reads is made from this list, so keep paths and schema names stable.

import { calibration } from './calibration';
import type { Ctx } from './context';
import { buildCaseTypes, buildCities, buildLeave, buildStandbyPoints, buildSubZones, buildAgentSkills, buildAgents, buildVehicles, buildZones, caseRecord } from './build-core';
import { buildAuditEvents, buildImports, buildNotifications } from './build-admin';
import { buildDashboardRollups, buildProductivityRollups } from './build-rollups';
import { applyOverrides, buildForecast, buildOptimizerOutput, buildRosters, buildScenarios, finalizeRosters, forecastValueRecord } from './build-plans';
import { buildLiveHistory, buildReplay, buildSimulations, simulatorOutput } from './build-live';
import {
  buildBreakRules,
  buildHijriMonths,
  buildHolidays,
  buildIntegrations,
  buildModelVersions,
  buildNotificationRules,
  buildPrayerTimes,
  buildRoleMappings,
  buildRules,
  buildSettings,
  buildShiftPatterns,
  buildUsers,
  userByKey,
} from './build-reference';
import type { FixtureFile } from './io';
import { iso, parseIso, dateRange } from './time';
import { plannedCasesForDay } from '../positions';
import { uuidFor } from './rng';

function arrayFile(path: string, schema: string, data: readonly unknown[], contract?: string): FixtureFile {
  return { path, schema, kind: 'array', data, ...(contract === undefined ? {} : { contract_schema: contract }) };
}

export function buildFixtures(ctx: Ctx): FixtureFile[] {
  const files: FixtureFile[] = [];

  // People who act in the data come first, so other records can point at them.
  const users = buildUsers(ctx);
  const admin = userByKey(users, 'administrator').id;
  const supervisor = userByKey(users, 'dispatch_supervisor').id;

  // Locations and reference data
  files.push(arrayFile('locations/cities.json', 'City', buildCities(ctx)));
  files.push(arrayFile('locations/zones.json', 'Zone', buildZones(ctx)));
  files.push(arrayFile('locations/sub_zones.json', 'SubZone', buildSubZones(ctx)));
  files.push(arrayFile('locations/standby_points.json', 'StandbyPoint', buildStandbyPoints(ctx)));
  files.push(arrayFile('reference/case_types.json', 'CaseType', buildCaseTypes(ctx)));
  files.push(arrayFile('reference/break_rules.json', 'BreakRule', buildBreakRules(ctx)));
  files.push(arrayFile('reference/shift_patterns.json', 'ShiftPattern', buildShiftPatterns(ctx)));
  const rules = buildRules(ctx, admin, supervisor);
  files.push(arrayFile('reference/classification_rules.json', 'ClassificationRule', rules.rules));
  files.push(arrayFile('reference/rule_versions.json', 'RuleVersion', rules.versions));
  files.push(arrayFile('reference/holidays.json', 'Holiday', buildHolidays(ctx)));
  files.push(arrayFile('reference/hijri_months.json', 'HijriMonth', buildHijriMonths(ctx)));
  files.push(arrayFile('reference/prayer_times.json', 'PrayerTime', buildPrayerTimes(ctx)));
  files.push(arrayFile('reference/model_versions.json', 'ModelVersion', buildModelVersions(ctx, admin)));

  // Admin
  files.push(arrayFile('admin/users.json', 'User', users.map((u) => u.record)));
  files.push(arrayFile('admin/role_mappings.json', 'RoleMapping', buildRoleMappings(ctx)));
  files.push(arrayFile('admin/settings.json', 'Setting', buildSettings(ctx, admin)));
  files.push(arrayFile('admin/notification_rules.json', 'NotificationRule', buildNotificationRules(ctx, admin)));
  files.push(arrayFile('admin/integrations.json', 'Integration', buildIntegrations(ctx, admin)));
  files.push(arrayFile('admin/notifications.json', 'Notification', buildNotifications(ctx, users)));

  // People and fleet
  files.push(arrayFile('people/agents.json', 'Agent', buildAgents(ctx)));
  files.push(arrayFile('people/vehicles.json', 'Vehicle', buildVehicles(ctx)));
  files.push(arrayFile('people/agent_skills.json', 'AgentSkill', buildAgentSkills(ctx)));
  const leave = buildLeave(ctx, supervisor);
  files.push(arrayFile('people/leave_requests.json', 'LeaveRequest', leave.map((l) => l.record)));

  // Cases, one file per day
  const weekDays = dateRange(ctx.firstCaseDay, ctx.lastCaseDay);
  const weekCases = weekDays.flatMap((d) => plannedCasesForDay(ctx.seed, d));
  for (const day of weekDays) {
    files.push(arrayFile(`cases/${day}.json`, 'Case', plannedCasesForDay(ctx.seed, day).map((c) => caseRecord(ctx, c))));
  }

  // Roll-ups the dashboards read
  files.push(arrayFile('rollups/dashboard_rollups.json', 'DashboardRollup', buildDashboardRollups(ctx, weekCases)));
  files.push(arrayFile('rollups/productivity_rollups.json', 'ProductivityRollup', buildProductivityRollups(ctx, weekCases)));

  // Import, data quality
  const imports = buildImports(ctx, users, weekCases);
  files.push(arrayFile('admin/import_jobs.json', 'ImportJob', imports.jobs));
  files.push(arrayFile('admin/data_quality_issues.json', 'DataQualityIssue', imports.issues));

  // Plans
  const forecast = buildForecast(ctx, admin);
  files.push(arrayFile('plans/forecast_runs.json', 'ForecastRun', [forecast.run]));
  for (const zone of ctx.world.locations.zones) {
    const rows = forecast.rows.filter((r) => r.zone_id === zone.id).map((r) => forecastValueRecord(ctx, forecast.runId, r));
    files.push(arrayFile(`plans/forecast_values/${zone.code}.json`, 'ForecastValue', rows));
  }
  const rosters = buildRosters(ctx, users, forecast);
  const ov = applyOverrides(ctx, users, rosters);
  finalizeRosters(ctx, rosters);
  files.push(arrayFile('plans/rosters.json', 'Roster', rosters.rosters.map((r) => r.record)));
  for (const date of dateRange(calibration.fixtures.roster_days.from, calibration.fixtures.roster_days.to)) {
    files.push(arrayFile(`plans/roster_assignments/${date}.json`, 'RosterAssignment', rosters.rosters.filter((r) => r.date === date).flatMap((r) => r.assignments.map((a) => a.record))));
  }
  files.push(arrayFile('plans/overrides.json', 'Override', ov.overrides));
  const scenarios = buildScenarios(ctx, users);
  files.push(arrayFile('plans/scenarios.json', 'Scenario', scenarios.map((s) => s.record)));

  // Live assignment: the previous day, and the simulations that use it
  const live = buildLiveHistory(ctx, users, ctx.lastCaseDay);
  files.push(arrayFile('live/assignments.json', 'Assignment', live.assignments));
  files.push(arrayFile('live/assignment_events.json', 'AssignmentEvent', live.events));
  files.push(arrayFile('live/assignment_comparisons.json', 'AssignmentComparison', live.comparisons));
  const sims = buildSimulations(ctx, users, live, scenarios, forecast.zoneTotals);
  files.push(arrayFile('plans/simulation_runs.json', 'SimulationRun', sims.runs));
  files.push(arrayFile('plans/simulation_results.json', 'SimulationResult', sims.results));

  // Approvals: the rules' (history) plus rosters' and overrides'
  files.push(arrayFile('reference/approvals.json', 'Approval', [...rules.approvals, ...ov.approvals]));

  // Audit, seeded
  files.push(arrayFile('admin/audit_events.json', 'AuditEvent', buildAuditEvents(ctx, users)));

  // Engine outputs (placeholders)
  const generatedAt = iso(parseIso(calibration.fixtures.forecast.run_created_at.value) + 240);
  files.push({
    path: 'engines/forecaster.output.json',
    schema: 'forecaster.output',
    kind: 'object',
    data: {
      schema_version: '1.0',
      request_id: uuidFor(ctx.seed, 'engine_request', 'forecaster'),
      engine: { name: 'forecaster', version: '0.1.0' },
      model_version: calibration.fixtures.forecast.model_version.value,
      generated_at: generatedAt,
      data_source: 'SYNTHETIC',
      input_data_sources: ['SYNTHETIC'],
      illustrative: true,
      rule_set_version: 'draft-2026-09',
      horizon: { start_date: calibration.fixtures.forecast.horizon_start.value, days: calibration.fixtures.forecast.horizon_days.value },
      interval_minutes: 15,
      intervals_per_day: 96,
      range_coverage: calibration.fixtures.forecast.range_coverage.value,
      values: forecast.rows.filter((r) => r.zone_id === ctx.world.locations.zones[0]?.id),
      warnings: [
        { code: 'PLACEHOLDER', message: 'Placeholder forecaster: values are shaped from the synthetic calibration, not learned. Illustrative.' },
        { code: 'ZONE_SUBSET', message: 'This example run covers Riyadh Central only, to keep the committed file small. forecast_values holds every zone.' },
      ],
    },
  });
  files.push({ path: 'engines/optimizer.output.json', schema: 'optimizer.output', kind: 'object', data: buildOptimizerOutput(ctx, rosters, calibration.fixtures.forecast.horizon_start.value) });
  files.push({ path: 'engines/simulator.output.json', schema: 'simulator.output', kind: 'object', data: simulatorOutput(ctx, sims) });

  // Replay
  const replay = buildReplay(ctx);
  files.push(arrayFile('replay/cases.json', 'ReplayCase', replay.cases, 'Case'));
  files.push(arrayFile('replay/assignment_outputs.json', 'assignment.output', replay.recommendations));
  files.push({ path: 'replay/script.json', schema: 'ReplayScript', kind: 'object', data: replay.script });

  return files;
}

