/**
 * GENERATED, do not edit.
 * Source: contracts/engines/optimizer.input.schema.json
 * Regenerate with: pnpm generate:types
 * The contracts under contracts/ are the single source of truth for these types.
 */

export type Uuid = string;
export type DataSource = 'SYNTHETIC' | 'IMPORTED' | 'LIVE';
export type LocalTime = string;

/**
 * Input to the roster optimizer: build a roster for one or more zones for one date, from a forecast, the people and vehicles available, shift patterns, break rules and prayer times. Also used by Scenario Lab, with scenario_adjustments applied on top of the base data. No tenant, customer or role appears here. additionalProperties is false so worker and fixture typos fail validation.
 */
export interface OptimizerInput {
  schema_version: '1.0';
  request_id: Uuid;
  requested_at: string;
  data_source: DataSource;
  input_data_sources?: DataSource[];
  roster_date: string;
  /**
   * @minItems 1
   */
  zone_ids: Uuid[];
  /**
   * Level at which gaps and surpluses are reported. Setting, default zone. Assumption: city and sub_zone are the other levels; a different level needs a location import, not a rebuild.
   */
  planning_level: 'zone' | 'sub_zone' | 'city';
  /**
   * Selects the normal or Ramadan hours of every shift pattern.
   */
  calendar_mode: 'normal' | 'ramadan';
  objective?: {
    /**
     * Which forecast value the roster must cover.
     */
    demand_quantile?: 'low' | 'expected' | 'high';
    /**
     * Capacity assumption: field cases one agent can handle in a 15-minute interval.
     */
    cases_per_agent_per_interval?: number;
    max_run_seconds?: number;
    /**
     * Optional. An agent is deployed only within this distance of the home dispatch center. Absent: home zone only, as before.
     */
    max_deploy_distance_km?: number;
    /**
     * Optional optimizer model, e.g. greedy-ls-0.2 or cpsat-1. Absent: greedy-ls-0.1, or greedy-ls-0.2 when service_level is sent. Unknown or unavailable: the default runs with warning MODEL_UNAVAILABLE.
     */
    model_version?: string;
    seed?: number;
    /**
     * Optional. Per zone and interval, ceil(field demand x share / cases_per_agent_per_interval) on-duty field agents must hold the skill. Shares of the same zone and skill add up (case types are disjoint), capped at 1, and never above the field requirement. zone_id absent: every zone. case_type_id only names where the share came from. A shortfall is a violation SKILL_COVERAGE_GAP per zone and skill. Absent: skills are not constrained, as before.
     *
     * @maxItems 200
     */
    skill_requirements?: {
      skill: string;
      share: number;
      zone_id?: Uuid;
      case_type_id?: Uuid;
    }[];
    /**
     * Optional. Per interval, the share of field demand whose sub-zone centre is within threshold_seconds of travel (travel_model) from a staffed standby point should reach target_share. Standby choice then maximises that share; a shortfall is a violation SERVICE_LEVEL_REACH and gap cells with cause geography. Absent: standby points are chosen to minimise overlap, as before.
     */
    service_level?: {
      threshold_seconds: number;
      target_share: number;
      /**
       * Where each sub-zone's demand is placed. A sub-zone with forecast demand but no centre here is counted as not reached.
       */
      sub_zone_centres?: {
        sub_zone_id: Uuid;
        zone_id: Uuid;
        latitude: number;
        longitude: number;
      }[];
    };
  };
  /**
   * Optional. How long a prayer blocks work after each adhan time, for break placement. Absent: 30.
   */
  prayer_window_minutes?: number;
  /**
   * Optional. Home point of each zone, for max_deploy_distance_km.
   */
  dispatch_centres?: {
    zone_id: string;
    latitude: number;
    longitude: number;
  }[];
  /**
   * Optional. Straight-line distance times detour_factor at average_speed_kmh, the same model the simulator uses. Defaults 40 km/h and 1.3.
   */
  travel_model?: {
    average_speed_kmh?: number;
    detour_factor?: number;
  };
  /**
   * Demand to cover, zone x sub-zone x 15-minute interval, same shape as ForecasterOutput values.
   */
  forecast: {
    /**
     * Identifier of the stored forecast run these values came from.
     */
    forecast_run_ref: string;
    values: {
      zone_id: Uuid;
      sub_zone_id: Uuid;
      interval_start: string;
      low: number;
      expected: number;
      high: number;
      field_expected: number;
      remote_inferred_expected: number;
    }[];
  };
  agents: {
    agent_id: Uuid;
    kind: 'field' | 'remote';
    /**
     * Null for remote agents, who belong to the remote pool rather than a zone (assumption).
     */
    home_zone_id?: string | null;
    skills: string[];
    default_vehicle_id?: string | null;
    /**
     * False when the agent is on approved leave or otherwise unavailable on roster_date.
     */
    available: boolean;
    unavailable_reason?: string;
    /**
     * Omit to allow every shift pattern of the agent's kind.
     */
    eligible_shift_pattern_ids?: Uuid[];
  }[];
  vehicles: {
    vehicle_id: Uuid;
    zone_id: Uuid;
    available: boolean;
  }[];
  /**
   * @minItems 1
   */
  shift_patterns: {
    shift_pattern_id: Uuid;
    code: string;
    kind: 'field' | 'remote';
    normal: ShiftHours;
    ramadan: ShiftHours;
    break_rule_id: Uuid;
  }[];
  break_rules: {
    break_rule_id: Uuid;
    break_minutes: number;
    after_consecutive_hours: number;
  }[];
  /**
   * Prayer times for roster_date (Asia/Riyadh), used to place breaks.
   */
  prayer_times?: {
    fajr: LocalTime;
    dhuhr: LocalTime;
    asr: LocalTime;
    maghrib: LocalTime;
    isha: LocalTime;
  };
  standby_points?: {
    standby_point_id: Uuid;
    zone_id: Uuid;
    latitude: number;
    longitude: number;
    coverage_radius_m?: number;
  }[];
  /**
   * Approved overrides the optimizer must keep.
   */
  fixed_assignments?: {
    agent_id: Uuid;
    shift_pattern_id: Uuid;
    zone_id: Uuid;
    vehicle_id?: string | null;
  }[];
  /**
   * Present only for Scenario Lab runs.
   */
  scenario_adjustments?: {
    headcount_delta?: {
      zone_id: Uuid;
      field_agents?: number;
      remote_agents?: number;
      vehicles?: number;
    }[];
    /**
     * Restrict the run to these shift patterns.
     */
    shift_pattern_ids?: Uuid[];
    /**
     * Override the share of cases handled remotely, 0 to 1.
     */
    remote_share?: number;
  };
}
/**
 * Local start and end time. end_time 00:00 means midnight at the end of the shift; a start later than the end means the shift crosses midnight.
 */
export interface ShiftHours {
  applies: boolean;
  start_time?: LocalTime;
  end_time?: LocalTime;
}
