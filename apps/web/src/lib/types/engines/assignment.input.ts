/**
 * GENERATED, do not edit.
 * Source: contracts/engines/assignment.input.schema.json
 * Regenerate with: pnpm generate:types
 * The contracts under contracts/ are the single source of truth for these types.
 */

export type Uuid = string;
export type DataSource = 'SYNTHETIC' | 'IMPORTED' | 'LIVE';

/**
 * Input to the assignment engine for ONE case: the case, the candidate agents with their current status and position, and the rules that apply now. The engine ranks candidates and never writes anything; the worker decides what to do with the ranking according to the stage of the zone (shadow, recommend, automatic) and never sends a second assignment for a case that already has one. No tenant, customer or role appears here. additionalProperties is false everywhere.
 */
export interface AssignmentInput {
  schema_version: '1.0';
  request_id: Uuid;
  requested_at: string;
  data_source: DataSource;
  input_data_sources?: DataSource[];
  /**
   * The decision clock. In a replay this is the replay time, not wall-clock time.
   */
  now: string;
  /**
   * Live-assignment stage of the case's zone. Informational for the engine.
   */
  stage?: 'shadow' | 'recommend' | 'automatic';
  /**
   * Time the engine has to answer. Working assumption 2000 (plan D4). The customer's own fallback fires at 5000.
   */
  decision_deadline_ms?: number;
  /**
   * Maximum length of the ranked list returned.
   */
  top_n?: number;
  case: {
    case_id: Uuid;
    registered_at: string;
    zone_id: Uuid;
    sub_zone_id?: Uuid;
    latitude: number;
    longitude: number;
    case_type_id?: Uuid;
    handling: 'field' | 'remote_inferred';
    parties_involved?: number;
    required_skills?: string[];
    /**
     * Set when the case already has an assignment. The engine then returns status already_assigned and no ranking.
     */
    existing_assignment_id?: string | null;
  };
  candidates: {
    agent_id: Uuid;
    status: 'available' | 'assigned' | 'en_route' | 'on_scene' | 'on_break' | 'offline';
    latitude: number;
    longitude: number;
    position_at: string;
    roster_zone_id?: string | null;
    shift_end_at?: string | null;
    on_break_until?: string | null;
    next_break_due_at?: string | null;
    skills: string[];
    has_vehicle: boolean;
    cases_today?: number;
    /**
     * When the agent is expected to finish the current case, if any.
     */
    busy_until?: string | null;
  }[];
  /**
   * Current or next prayer time window during which agents should not be dispatched unless urgent.
   */
  prayer_window?: {
    name?: 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';
    starts_at?: string;
    ends_at?: string;
  } | null;
  travel_model?: {
    average_speed_kmh?: number;
    detour_factor?: number;
  };
}
