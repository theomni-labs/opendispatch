/**
 * GENERATED, do not edit.
 * Source: contracts/engines/forecaster.output.schema.json
 * Regenerate with: pnpm generate:types
 * The contracts under contracts/ are the single source of truth for these types.
 */

export type Uuid = string;
export type DataSource = 'SYNTHETIC' | 'IMPORTED' | 'LIVE';

/**
 * Demand forecast per zone x sub-zone x 15-minute interval. Every value carries low, expected and high. INVARIANTS (JSON Schema cannot express them; validate-contracts and the engine tests check them): (1) low <= expected <= high; (2) field_expected + remote_inferred_expected equals expected within 0.01; (3) 96 intervals per day: interval_index 0 to 95, interval_start aligned to the quarter hour, so a horizon of N days holds N x 96 values for each (zone_id, sub_zone_id) pair, exactly once each; (4) interval_index equals the quarter-hour slot of interval_start in Asia/Riyadh. Values are expected case counts per interval (not integers). Placeholder engines must set illustrative to true; a screen may show a forecast figure as measured only when data_source is LIVE or IMPORTED and illustrative is false.
 */
export interface ForecasterOutput {
  schema_version: '1.0';
  request_id: Uuid;
  engine: {
    name: 'forecaster';
    version: string;
  };
  model_version: string;
  generated_at: string;
  data_source: DataSource;
  input_data_sources?: DataSource[];
  /**
   * True while the forecast is a placeholder or was produced from synthetic data. Screens show the word Illustrative next to any number when true.
   */
  illustrative: boolean;
  rule_set_version?: string;
  horizon: {
    start_date: string;
    days: number;
  };
  interval_minutes: 15;
  intervals_per_day: 96;
  range_coverage: number;
  values: ForecastIntervalValue[];
  warnings?: {
    code: string;
    message: string;
  }[];
  model_info?: {
    /**
     * @maxItems 64
     */
    feature_set?: string[];
    training_start?: string;
    training_end?: string;
    history_days?: number;
  };
  /**
   * Optional: where inside each sub-zone cases are likely, as probabilities over micro-cells (geohash) by hour of day and day group. Present only when the request carried location_records.
   */
  location_distributions?: {
    sub_zone_id: string;
    hour: number;
    day_group: 'weekday' | 'thursday' | 'friday' | 'saturday';
    /**
     * @maxItems 400
     */
    cells: {
      cell_id: string;
      probability: number;
    }[];
  }[];
  /**
   * Optional: why each zone and day has its number. base is the zone's typical daily level in expected cases; base times the product of the drivers' multipliers equals expected, the zone-day total of values (within rounding). Drivers: weekday, trend, annual_season, a calendar or weather effect named as in model_info.feature_set (holiday, ramadan, payday, salary_window, school_break, school_<period>, event_<type>, weather_<kind>, traffic_<kind>), and model_other (the blend with the profile model, sub-zone drift, prayer lull and Ramadan hours). unknown: the day's calendar value was not sent, so the multiplier is the expected effect. Absent when the model has no day-level effects (the profile model, or the ensemble falling back to it).
   */
  explanations?: {
    zone_id: string;
    date: string;
    base: number;
    expected: number;
    /**
     * @maxItems 64
     */
    drivers: ExplanationDriver[];
  }[];
}
/**
 * One zone x sub-zone x 15-minute interval. low <= expected <= high.
 */
export interface ForecastIntervalValue {
  zone_id: Uuid;
  sub_zone_id: Uuid;
  interval_start: string;
  interval_index: number;
  low: number;
  expected: number;
  high: number;
  /**
   * Expected cases handled in the field (classified with the rule set).
   */
  field_expected: number;
  /**
   * Expected cases handled remotely. Inferred until the customer supplies an explicit field.
   */
  remote_inferred_expected: number;
}
/**
 * One driver of a zone-day forecast: a multiplier on the zone's base level. unknown: the day's calendar value was not sent, so the multiplier is the expected effect.
 */
export interface ExplanationDriver {
  driver: string;
  multiplier: number;
  unknown?: boolean;
}
