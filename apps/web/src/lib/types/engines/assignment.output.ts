/**
 * GENERATED, do not edit.
 * Source: contracts/engines/assignment.output.schema.json
 * Regenerate with: pnpm generate:types
 * The contracts under contracts/ are the single source of truth for these types.
 */

export type Uuid = string;
export type DataSource = 'SYNTHETIC' | 'IMPORTED' | 'LIVE';
/**
 * Why an agent is ranked where they are. Positive codes explain a high rank; caution codes explain a trade-off the dispatcher may want to know about.
 */
export type AssignmentReasonCode =
  | 'NEAREST_BY_TRAVEL_TIME'
  | 'SHORTER_TRAVEL_THAN_NEXT'
  | 'HAS_REQUIRED_SKILL'
  | 'VEHICLE_AVAILABLE'
  | 'LOWER_WORKLOAD'
  | 'IN_ROSTER_ZONE'
  | 'AVAILABLE_NOW'
  | 'BREAK_DUE_SOON'
  | 'PRAYER_TIME_SOON'
  | 'SHIFT_ENDING_SOON'
  | 'FINISHING_CURRENT_CASE'
  | 'LONGER_TRAVEL_THAN_BEST'
  | 'HIGHER_WORKLOAD'
  | 'OUTSIDE_ROSTER_ZONE'
  | 'POSITION_NOT_RECENT';

/**
 * Assignment engine result for ONE case: a ranked list of agents, each with the estimated travel time in seconds and the reason for the ranking as structured reason codes plus a short English text. Screens localise from the codes; the text is a fallback. Candidates that were ruled out are listed with an exclusion code so the dispatcher can see why a nearby agent was skipped. INVARIANTS checked by validate-contracts: ranks run 1, 2, 3 in list order with no gaps; an agent appears once; status ranked has at least one ranking entry; already_assigned and no_eligible_agent have an empty ranking. Travel time need not rise with rank: skills, workload, breaks and prayer times can put a farther agent first, and the reason codes say why.
 */
export interface AssignmentOutput {
  schema_version: '1.0';
  request_id: Uuid;
  engine: {
    name: 'assignment';
    version: string;
  };
  model_version: string;
  generated_at: string;
  data_source: DataSource;
  input_data_sources?: DataSource[];
  illustrative: boolean;
  case_id: Uuid;
  /**
   * ranked: at least one eligible agent. no_eligible_agent: nobody can be sent (dispatcher decides). already_assigned: the case already has an assignment; nothing is ranked.
   */
  status: 'ranked' | 'no_eligible_agent' | 'already_assigned';
  decision_time_ms: number;
  /**
   * True when the engine ran out of time and returned its best partial ranking.
   */
  deadline_exceeded?: boolean;
  ranking: RankedAgent[];
  excluded?: {
    agent_id: Uuid;
    exclusion_code:
      | 'OFFLINE'
      | 'OFF_SHIFT'
      | 'ON_BREAK'
      | 'PRAYER_TIME'
      | 'NO_VEHICLE'
      | 'MISSING_SKILL'
      | 'BUSY'
      | 'OUT_OF_ZONE'
      | 'STALE_POSITION';
    text?: string;
  }[];
}
export interface RankedAgent {
  rank: number;
  agent_id: Uuid;
  estimated_travel_seconds: number;
  estimated_arrival_at: string;
  /**
   * Higher is better. Comparable only within this response.
   */
  score: number;
  /**
   * @minItems 1
   */
  reason_codes: AssignmentReasonCode[];
  /**
   * One short English sentence for the dispatcher.
   */
  reason_text: string;
}
