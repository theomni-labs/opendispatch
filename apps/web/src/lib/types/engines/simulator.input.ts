/**
 * GENERATED, do not edit.
 * Source: contracts/engines/simulator.input.schema.json
 * Regenerate with: pnpm generate:types
 * The contracts under contracts/ are the single source of truth for these types.
 */

export type Uuid = string;
export type DataSource = 'SYNTHETIC' | 'IMPORTED' | 'LIVE';

/**
 * Input to the service-level simulator: replay a set of cases against a proposed roster and report service levels. The result always carries BOTH 10-minute readings (from registration and from assignment); clock_start_primary only says which one is the headline figure (setting, default assignment). No tenant, customer or role appears here. additionalProperties is false everywhere.
 */
export interface SimulatorInput {
  schema_version: '1.0';
  request_id: Uuid;
  requested_at: string;
  data_source: DataSource;
  input_data_sources?: DataSource[];
  /**
   * Setting: when the 10-minute clock starts for the headline figure. Default assignment (a configurable assumption). Both readings are always returned.
   */
  clock_start_primary: 'assignment' | 'registration';
  /**
   * The service-level threshold. 600 for the 10-minute target.
   */
  threshold_seconds: number;
  /**
   * How simulated cases are given to agents. nearest: closest agent by travel time (baseline). scorer: the assignment engine's ranking. replay_actual: use the assignments recorded in the cases (a reproduction of history).
   */
  assignment_policy?: 'nearest' | 'scorer' | 'replay_actual';
  travel_model?: {
    average_speed_kmh?: number;
    detour_factor?: number;
  };
  seed?: number;
  /**
   * When true the output lists every simulated case. Leave false for large replays.
   */
  include_case_outcomes?: boolean;
  /**
   * Cases to replay. Field cases consume agent capacity; remote_inferred cases go to the remote queue.
   */
  cases: {
    case_id: Uuid;
    registered_at: string;
    zone_id: Uuid;
    sub_zone_id?: Uuid;
    latitude: number;
    longitude: number;
    handling: 'field' | 'remote_inferred';
    parties_involved?: number;
    /**
     * Time on scene to simulate. Omit to let the engine sample from its configured distribution.
     */
    on_scene_seconds?: number;
    /**
     * Recorded assignment time; used only by replay_actual. May be earlier than registered_at (a known feature of the sample).
     */
    actual_assigned_at?: string | null;
    actual_agent_id?: string | null;
    actual_arrived_at?: string | null;
  }[];
  /**
   * The proposed roster to test.
   */
  roster: {
    roster_ref: string;
    assignments: {
      agent_id: Uuid;
      shift_pattern_id: Uuid;
      zone_id?: string | null;
      start_at: string;
      end_at: string;
      break_start_at?: string | null;
      break_end_at?: string | null;
      start_latitude?: number;
      start_longitude?: number;
    }[];
  };
}
