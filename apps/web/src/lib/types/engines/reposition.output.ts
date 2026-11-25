/**
 * GENERATED, do not edit.
 * Source: contracts/engines/reposition.output.schema.json
 * Regenerate with: pnpm generate:types
 * The contracts under contracts/ are the single source of truth for these types.
 */

export type Uuid = string;
export type DataSource = 'SYNTHETIC' | 'IMPORTED' | 'LIVE';

/**
 * Suggested waiting spots for idle agents of one zone (advisory; the operator fallback rule: never an assignment).
 */
export interface RepositionOutput {
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
  zone_id: Uuid;
  decision_time_ms: number;
  /**
   * Only agents asked to move; one who should stay is left out.
   *
   * @maxItems 2000
   */
  waiting_spots: {
    agent_id: Uuid;
    latitude: number;
    longitude: number;
    move_km: number;
    reason_code: 'cover_expected_demand' | 'rebalance_zone';
  }[];
}
