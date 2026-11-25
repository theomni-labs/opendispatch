/**
 * GENERATED, do not edit.
 * Source: contracts/engines/simulator.output.schema.json
 * Regenerate with: pnpm generate:types
 * The contracts under contracts/ are the single source of truth for these types.
 */

export type Uuid = string;
export type DataSource = 'SYNTHETIC' | 'IMPORTED' | 'LIVE';

/**
 * Replay of cases against a roster, with service-level results. Every result carries BOTH readings of the 10-minute target: from_registration (registered_at to arrived_at) and from_assignment (assigned_at to arrived_at). primary_clock_start says which is the headline, per the setting (default assignment); a screen never shows only one reading until the customer confirms when the clock starts. Results are reported overall (overall), per zone (zones) and per 15-minute interval of registration (intervals). INVARIANTS checked by validate-contracts: within_count <= case_count; share = within_count / case_count when case_count > 0, else null; assigned_to_arrived and registered_to_arrived populate only for field cases. Simulated figures on synthetic data are illustrative: illustrative must be true unless data_source is LIVE or IMPORTED and the roster and cases are real.
 */
export interface SimulatorOutput {
  schema_version: '1.0';
  request_id: Uuid;
  engine: {
    name: 'simulator';
    version: string;
  };
  model_version: string;
  generated_at: string;
  data_source: DataSource;
  input_data_sources?: DataSource[];
  illustrative: boolean;
  roster_ref: string;
  assignment_policy?: 'nearest' | 'scorer' | 'replay_actual';
  primary_clock_start: 'assignment' | 'registration';
  threshold_seconds: number;
  overall: SimulatedServiceLevel;
  zones?: {
    zone_id: Uuid;
    service_level: SimulatedServiceLevel;
  }[];
  intervals?: {
    zone_id: Uuid;
    interval_start: string;
    interval_index: number;
    service_level: SimulatedServiceLevel;
  }[];
  /**
   * Field cases with no agent available in the simulation.
   */
  unserved_cases?: number;
  warnings?: {
    code: string;
    message: string;
  }[];
  /**
   * Present only when the input asked for include_case_outcomes.
   */
  case_outcomes?: SimulatedCaseOutcome[];
}
export interface SimulatedServiceLevel {
  case_count: number;
  field_case_count: number;
  remote_case_count?: number;
  from_registration: TenMinuteReadingResult;
  from_assignment: TenMinuteReadingResult;
  registered_to_assigned?: SimulatedPercentiles;
  assigned_to_arrived?: SimulatedPercentiles;
  registered_to_arrived?: SimulatedPercentiles;
  /**
   * Share of on-duty time agents spent travelling or on scene, 0 to 1.
   */
  agent_utilisation?: number | null;
}
/**
 * Share of field cases with an agent on scene within the threshold, for one clock start.
 */
export interface TenMinuteReadingResult {
  within_count: number;
  case_count: number;
  share: number | null;
}
export interface SimulatedPercentiles {
  median_seconds: number | null;
  p90_seconds: number | null;
}
export interface SimulatedCaseOutcome {
  case_id: Uuid;
  served: boolean;
  agent_id?: string | null;
  assigned_at?: string | null;
  arrived_at?: string | null;
  registered_to_arrived_seconds?: number | null;
  assigned_to_arrived_seconds?: number | null;
  within_from_registration?: boolean | null;
  within_from_assignment?: boolean | null;
}
