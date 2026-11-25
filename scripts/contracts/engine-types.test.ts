// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Type-level and runtime test for the engine types exported by the generated barrel
 * (apps/web/src/lib/types/index.ts).
 *
 * Each document below is written as a typed literal, so `tsc` (pnpm typecheck, and the
 * validate:contracts type check) fails if a valid document stops being assignable to an exported
 * type. The same documents are validated against the JSON Schemas at run time, so they stay
 * valid documents. The `@ts-expect-error` lines fail `tsc` if they stop being errors.
 *
 * Two families of engine types are exported and must stay interchangeable:
 *   - ForecasterOutput and friends, generated from contracts/engines by json-schema-to-typescript;
 *   - ForecasterEngineOutput and friends, the openapi-typescript versions used inside the API
 *     types (ScenarioRunResult.optimizer, SimulationRunDetail.output, LiveBoard, ...).
 */
import { describe, expect, it } from 'vitest';
import type {
  AssignmentEngineOutput,
  AssignmentInput,
  AssignmentOutput,
  ForecasterEngineOutput,
  ForecasterInput,
  ForecasterOutput,
  OptimizerEngineOutput,
  OptimizerInput,
  OptimizerOutput,
  ScenarioRunResult,
  SimulationRunDetail,
  SimulatorEngineOutput,
  SimulatorInput,
  SimulatorOutput,
} from '../../apps/web/src/lib/types/index';
import { createAjv, getEngineSchema } from './schemas.js';

const ID = (n: number): string => `3f6f1b1e-7a55-4c27-9d0a-${String(n).padStart(12, '0')}`;
const NOW = '2026-09-14T09:12:01+03:00';

const forecasterInput: ForecasterInput = {
  schema_version: '1.0',
  request_id: ID(1),
  requested_at: NOW,
  data_source: 'SYNTHETIC',
  horizon: { start_date: '2026-09-14', days: 1 },
  model: { model_version: 'placeholder-0.1', range_coverage: 0.8 },
  zones: [{ zone_id: ID(2), sub_zones: [{ sub_zone_id: ID(3) }] }],
  calendar: [{ date: '2026-09-14', is_holiday: false, is_ramadan: false }],
  history: { records: [{ sub_zone_id: ID(3), interval_start: NOW, cases_total: 4, cases_field: 3 }] },
};

const forecasterOutput: ForecasterOutput = {
  schema_version: '1.0',
  request_id: ID(1),
  engine: { name: 'forecaster', version: '0.1.0' },
  model_version: 'placeholder-0.1',
  generated_at: NOW,
  data_source: 'SYNTHETIC',
  illustrative: true,
  horizon: { start_date: '2026-09-14', days: 1 },
  interval_minutes: 15,
  intervals_per_day: 96,
  range_coverage: 0.8,
  values: [
    {
      zone_id: ID(2),
      sub_zone_id: ID(3),
      interval_start: '2026-09-14T07:00:00+03:00',
      interval_index: 28,
      low: 2.1,
      expected: 3.4,
      high: 5.2,
      field_expected: 2.2,
      remote_inferred_expected: 1.2,
    },
  ],
};

const optimizerInput: OptimizerInput = {
  schema_version: '1.0',
  request_id: ID(4),
  requested_at: NOW,
  data_source: 'SYNTHETIC',
  roster_date: '2026-09-14',
  zone_ids: [ID(2)],
  planning_level: 'zone',
  calendar_mode: 'normal',
  forecast: { forecast_run_ref: 'run-0001', values: [] },
  agents: [{ agent_id: ID(5), kind: 'field', skills: ['general'], available: true }],
  vehicles: [{ vehicle_id: ID(6), zone_id: ID(2), available: true }],
  shift_patterns: [
    {
      shift_pattern_id: ID(7),
      code: 'DAY_A',
      kind: 'field',
      normal: { applies: true, start_time: '06:00', end_time: '14:00' },
      ramadan: { applies: true, start_time: '06:00', end_time: '12:00' },
      break_rule_id: ID(8),
    },
  ],
  break_rules: [{ break_rule_id: ID(8), break_minutes: 30, after_consecutive_hours: 5 }],
};

const optimizerOutput: OptimizerOutput = {
  schema_version: '1.0',
  request_id: ID(4),
  engine: { name: 'optimizer', version: '0.1.0' },
  model_version: 'feasibility-check-0.1',
  generated_at: NOW,
  data_source: 'SYNTHETIC',
  illustrative: true,
  roster_date: '2026-09-14',
  status: 'partial',
  roster_assignments: [
    {
      agent_id: ID(5),
      shift_pattern_id: ID(7),
      zone_id: ID(2),
      roster_date: '2026-09-14',
      start_at: '2026-09-14T06:00:00+03:00',
      end_at: '2026-09-14T14:00:00+03:00',
    },
  ],
  vehicle_assignments: [
    { vehicle_id: ID(6), agent_id: ID(5), zone_id: ID(2), roster_date: '2026-09-14', shift_pattern_id: ID(7) },
  ],
  gap_cells: [
    {
      zone_id: ID(2),
      interval_start: '2026-09-14T07:00:00+03:00',
      interval_index: 28,
      required: 2,
      planned: 1,
      delta: -1,
      kind: 'gap',
      cause: 'people',
    },
  ],
};

const simulatorInput: SimulatorInput = {
  schema_version: '1.0',
  request_id: ID(9),
  requested_at: NOW,
  data_source: 'SYNTHETIC',
  clock_start_primary: 'assignment',
  threshold_seconds: 600,
  cases: [
    {
      case_id: ID(10),
      registered_at: '2026-09-14T07:02:00+03:00',
      zone_id: ID(2),
      latitude: 24.71,
      longitude: 46.68,
      handling: 'field',
    },
  ],
  roster: {
    roster_ref: 'roster-0001',
    assignments: [
      { agent_id: ID(5), shift_pattern_id: ID(7), start_at: '2026-09-14T06:00:00+03:00', end_at: '2026-09-14T14:00:00+03:00' },
    ],
  },
};

const simulatorOutput: SimulatorOutput = {
  schema_version: '1.0',
  request_id: ID(9),
  engine: { name: 'simulator', version: '0.1.0' },
  model_version: 'nearest-baseline-0.1',
  generated_at: NOW,
  data_source: 'SYNTHETIC',
  illustrative: true,
  roster_ref: 'roster-0001',
  primary_clock_start: 'assignment',
  threshold_seconds: 600,
  overall: {
    case_count: 10,
    field_case_count: 8,
    from_registration: { within_count: 3, case_count: 8, share: 0.375 },
    from_assignment: { within_count: 6, case_count: 8, share: 0.75 },
  },
};

const assignmentInput: AssignmentInput = {
  schema_version: '1.0',
  request_id: ID(11),
  requested_at: NOW,
  data_source: 'SYNTHETIC',
  now: NOW,
  case: {
    case_id: ID(10),
    registered_at: '2026-09-14T09:11:40+03:00',
    zone_id: ID(2),
    latitude: 24.71,
    longitude: 46.68,
    handling: 'field',
  },
  candidates: [
    {
      agent_id: ID(5),
      status: 'available',
      latitude: 24.7,
      longitude: 46.7,
      position_at: NOW,
      skills: ['general'],
      has_vehicle: true,
    },
  ],
};

const assignmentOutput: AssignmentOutput = {
  schema_version: '1.0',
  request_id: ID(11),
  engine: { name: 'assignment', version: '0.1.0' },
  model_version: 'nearest-baseline-0.1',
  generated_at: NOW,
  data_source: 'SYNTHETIC',
  illustrative: true,
  case_id: ID(10),
  status: 'ranked',
  decision_time_ms: 84,
  ranking: [
    {
      rank: 1,
      agent_id: ID(5),
      estimated_travel_seconds: 420,
      estimated_arrival_at: '2026-09-14T09:19:01+03:00',
      score: 0.91,
      reason_codes: ['NEAREST_BY_TRAVEL_TIME'],
      reason_text: 'Closest available agent.',
    },
  ],
};

// The barrel's openapi-typescript engine output types accept the same documents, with no `$defs`
// and no other schema-file keyword required.
const forecasterViaApi: ForecasterEngineOutput = forecasterOutput;
const optimizerViaApi: OptimizerEngineOutput = optimizerOutput;
const simulatorViaApi: SimulatorEngineOutput = simulatorOutput;
const assignmentViaApi: AssignmentEngineOutput = assignmentOutput;

// ...and the two families are interchangeable in both directions.
const forecasterBack: ForecasterOutput = forecasterViaApi;
const optimizerBack: OptimizerOutput = optimizerViaApi;
const simulatorBack: SimulatorOutput = simulatorViaApi;
const assignmentBack: AssignmentOutput = assignmentViaApi;

// Composite API types that embed the engine outputs take them directly.
const scenarioRun: ScenarioRunResult = {
  scenario_id: ID(12),
  generated_at: NOW,
  optimizer: optimizerOutput,
  simulation: simulatorOutput,
  illustrative: true,
  data_source: 'SYNTHETIC',
};
const simulationDetail: SimulationRunDetail = {
  run: {
    id: ID(13),
    tenant_id: ID(14),
    created_at: NOW,
    updated_at: NOW,
    created_by: null,
    data_source: 'SYNTHETIC',
    roster_id: ID(15),
    run_date: '2026-09-14',
    assignment_policy: 'nearest',
    primary_clock_start: 'assignment',
    threshold_seconds: 600,
    status: 'succeeded',
    illustrative: true,
  },
  output: simulatorOutput,
};

// @ts-expect-error a required field is missing (overall)
const missingField: SimulatorEngineOutput = { ...simulatorOutput, overall: undefined };
// @ts-expect-error schema-file keywords are not part of the payload
const withDefs: OptimizerEngineOutput = { ...optimizerOutput, $defs: {} };
// @ts-expect-error the engine name is a constant
const wrongEngine: ForecasterOutput = { ...forecasterOutput, engine: { name: 'optimizer', version: '1' } };
// @ts-expect-error an assignment reason must be one of the listed codes
const wrongReason: AssignmentOutput = { ...assignmentOutput, ranking: [{ ...assignmentOutput.ranking[0]!, reason_codes: ['BECAUSE'] }] };
// @ts-expect-error clock_start_primary is assignment or registration
const wrongClock: SimulatorInput = { ...simulatorInput, clock_start_primary: 'dispatch' };

const documents: Record<string, unknown> = {
  'forecaster.input': forecasterInput,
  'forecaster.output': forecasterOutput,
  'optimizer.input': optimizerInput,
  'optimizer.output': optimizerOutput,
  'simulator.input': simulatorInput,
  'simulator.output': simulatorOutput,
  'assignment.input': assignmentInput,
  'assignment.output': assignmentOutput,
};

describe('engine types in the generated barrel', () => {
  it.each(Object.keys(documents))('the %s test document is valid against its schema', (name) => {
    const validate = createAjv().compile(getEngineSchema(name));
    expect(validate(documents[name]), JSON.stringify(validate.errors)).toBe(true);
  });

  it('every engine output document is accepted by both type families (checked by tsc)', () => {
    const all = [forecasterViaApi, optimizerViaApi, simulatorViaApi, assignmentViaApi, forecasterBack, optimizerBack, simulatorBack, assignmentBack];
    expect(all).toHaveLength(8);
    expect(scenarioRun.optimizer.roster_date).toBe('2026-09-14');
    expect(simulationDetail.output?.roster_ref).toBe('roster-0001');
  });

  it('keeps the unused negative cases referenced so they are compiled', () => {
    expect([missingField, withDefs, wrongEngine, wrongReason, wrongClock]).toHaveLength(5);
  });
});
