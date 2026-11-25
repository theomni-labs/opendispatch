/**
 * GENERATED, do not edit.
 * Source: contracts/engines/reposition.input.schema.json
 * Regenerate with: pnpm generate:types
 * The contracts under contracts/ are the single source of truth for these types.
 */

export type Uuid = string;
export type DataSource = 'SYNTHETIC' | 'IMPORTED' | 'LIVE';

/**
 * Where the idle field agents of one zone should wait, given the expected demand of the look-ahead window. Advisory: no case is assigned or reassigned.
 */
export interface RepositionInput {
  schema_version: '1.0';
  request_id: Uuid;
  requested_at: string;
  data_source: DataSource;
  input_data_sources?: DataSource[];
  /**
   * The decision clock; in a replay, the replay time.
   */
  now: string;
  zone_id: Uuid;
  settings?: {
    min_move_km?: number;
    max_move_km?: number;
    look_ahead_hours?: number;
  };
  /**
   * @maxItems 2000
   */
  idle_agents: {
    agent_id: Uuid;
    latitude: number;
    longitude: number;
  }[];
  /**
   * Expected field cases per micro-cell over the look-ahead window, from the forecaster's sub-zone intervals and micro-cell shares.
   *
   * @maxItems 20000
   */
  demand_cells: {
    latitude: number;
    longitude: number;
    expected_cases: number;
  }[];
}
