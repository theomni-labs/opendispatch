/**
 * GENERATED, do not edit.
 * Source: contracts/engines/optimizer.output.schema.json
 * Regenerate with: pnpm generate:types
 * The contracts under contracts/ are the single source of truth for these types.
 */

export type Uuid = string;
export type DataSource = 'SYNTHETIC' | 'IMPORTED' | 'LIVE';

/**
 * Roster optimizer result: roster assignments (agent x shift x zone x date), vehicle assignments, and the gap or surplus per zone x 15-minute interval with its cause. Convention for gap_cells: delta = planned - required; delta < 0 is a gap, delta > 0 is a surplus, delta = 0 is balanced. cause is people, vehicles or geography for gap and surplus cells and null for balanced cells. INVARIANTS checked by validate-contracts: kind agrees with the sign of delta; balanced cells have cause null; every roster assignment agent_id appears once per shift per date.
 */
export interface OptimizerOutput {
  schema_version: '1.0';
  request_id: Uuid;
  engine: {
    name: 'optimizer';
    version: string;
  };
  model_version: string;
  generated_at: string;
  data_source: DataSource;
  input_data_sources?: DataSource[];
  illustrative: boolean;
  roster_date: string;
  /**
   * feasible: every interval covered. partial: a roster was built but gaps remain. infeasible: no roster could satisfy the hard rules (see violations).
   */
  status: 'feasible' | 'partial' | 'infeasible';
  /**
   * Optional. optimal: proven optimal within the time limit. feasible: best found, not proven. heuristic: a heuristic model, no proof.
   */
  solver_status?: 'optimal' | 'feasible' | 'heuristic';
  run_seconds?: number;
  roster_assignments: OptimizerRosterAssignment[];
  vehicle_assignments: OptimizerVehicleAssignment[];
  gap_cells: GapCell[];
  /**
   * Optional. What breaks cost each zone in coverage.
   */
  break_cost?: {
    zone_id: string;
    breaks: number;
    lost_agent_intervals: number;
    max_concurrent_breaks: number;
  }[];
  violations?: {
    code: string;
    message: string;
    zone_id?: Uuid;
    agent_id?: Uuid;
  }[];
}
/**
 * One agent on one shift in one zone on one date. Remote agents have zone_id null (remote pool).
 */
export interface OptimizerRosterAssignment {
  agent_id: Uuid;
  shift_pattern_id: Uuid;
  zone_id: string | null;
  roster_date: string;
  start_at: string;
  end_at: string;
  break_start_at?: string | null;
  break_end_at?: string | null;
  standby_point_id?: string | null;
}
export interface OptimizerVehicleAssignment {
  vehicle_id: Uuid;
  agent_id: Uuid;
  zone_id: Uuid;
  roster_date: string;
  shift_pattern_id: Uuid;
}
/**
 * Gap or surplus for one zone and one 15-minute interval, in agents on duty.
 */
export interface GapCell {
  zone_id: Uuid;
  interval_start: string;
  interval_index: number;
  required: number;
  planned: number;
  delta: number;
  kind: 'gap' | 'surplus' | 'balanced';
  /**
   * people: too few or too many agents. vehicles: agents exist but vehicles do not. geography: total numbers are enough but standby positions leave sub-zones uncovered. Null when kind is balanced.
   */
  cause: 'people' | 'vehicles' | 'geography' | null;
  cause_detail?: string;
  /**
   * Optional. Share of the interval's field demand, 0 to 1, whose sub-zone centre is within the service-level threshold of travel from a staffed standby point. Present only when the request had objective.service_level (optimizer) or the zone has sub-zones and standby points (api), and the interval has field demand.
   */
  reach_share?: number;
}
