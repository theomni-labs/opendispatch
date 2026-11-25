/**
 * GENERATED, do not edit.
 * Source: contracts/engines/forecaster.input.schema.json
 * Regenerate with: pnpm generate:types
 * The contracts under contracts/ are the single source of truth for these types.
 */

export type Uuid = string;
export type DataSource = 'SYNTHETIC' | 'IMPORTED' | 'LIVE';
export type LocalTime = string;
export type CellId = string;
export type DayGroup = 'weekday' | 'thursday' | 'friday' | 'saturday';

/**
 * Input to the demand forecaster. Aggregated history only (counts per sub-zone and 15-minute interval); the engine never receives case rows, coordinates of cases, or personal data. No tenant, customer or role appears here: the worker holds the tenant and stores the result under it. Timestamps are ISO 8601 with the +03:00 offset (Asia/Riyadh); interval_start values are aligned to :00, :15, :30 and :45. additionalProperties is false everywhere so a typo in a fixture or a worker payload fails validation instead of being ignored.
 */
export interface ForecasterInput {
  /**
   * Version of this contract. Additive changes keep 1.x.
   */
  schema_version: '1.0';
  request_id: Uuid;
  requested_at: string;
  data_source: DataSource;
  /**
   * Every distinct data_source among the inputs. More than one entry means the inputs are mixed and every screen must say so.
   */
  input_data_sources?: DataSource[];
  horizon: {
    start_date: string;
    /**
     * Days forecast from start_date: 1 to 30 (the planning horizon is 7 to 30 days; was at most 14 before 1.0 allowed 30).
     */
    days: number;
  };
  model: {
    /**
     * Forecast model version selected in Forecast and Model Admin.
     */
    model_version: string;
    /**
     * Share of outcomes the low to high range should contain, for example 0.8 means low is the 10th and high the 90th percentile.
     */
    range_coverage: number;
  };
  /**
   * Label of the classification rule set used to count field cases in the history (assumption: precedence Field mandatory over Field preferred over Remote eligible; no match means Field preferred).
   */
  rule_set_version?: string;
  /**
   * The location structure to forecast: one entry per zone with its sub-zones (forecast areas).
   *
   * @minItems 1
   */
  zones: {
    zone_id: Uuid;
    city_id?: Uuid;
    region?: 'central' | 'western';
    /**
     * @minItems 1
     */
    sub_zones: {
      sub_zone_id: Uuid;
      latitude?: number;
      longitude?: number;
    }[];
  }[];
  /**
   * One entry per day of the horizon, plus any history days the model needs.
   *
   * @minItems 1
   */
  calendar: {
    date: string;
    is_holiday: boolean;
    holiday_name?: string;
    is_ramadan: boolean;
    is_payday?: boolean;
    salary_window?: boolean;
    school_in_session?: boolean;
    school_period?:
      | 'semester'
      | 'exams'
      | 'vacation_summer'
      | 'vacation_eid_fitr'
      | 'vacation_eid_adha'
      | 'vacation_national'
      | 'vacation_long_weekend'
      | 'vacation_mid_semester'
      | 'vacation_between_semesters'
      | 'other';
    school_period_by_region?: {
      central?:
        | 'semester'
        | 'exams'
        | 'vacation_summer'
        | 'vacation_eid_fitr'
        | 'vacation_eid_adha'
        | 'vacation_national'
        | 'vacation_long_weekend'
        | 'vacation_mid_semester'
        | 'vacation_between_semesters'
        | 'other';
      western?:
        | 'semester'
        | 'exams'
        | 'vacation_summer'
        | 'vacation_eid_fitr'
        | 'vacation_eid_adha'
        | 'vacation_national'
        | 'vacation_long_weekend'
        | 'vacation_mid_semester'
        | 'vacation_between_semesters'
        | 'other';
    };
    /**
     * @maxItems 8
     */
    events?: {
      type: 'eid' | 'national_day' | 'season_event' | 'hajj' | 'umrah' | 'other';
      name?: string;
      /**
       * @maxItems 100
       */
      zone_ids?: Uuid[];
    }[];
    hijri_date?: {
      year: number;
      month: number;
      day: number;
    };
    /**
     * Local times (Asia/Riyadh), HH:MM.
     */
    prayer_times?: {
      fajr: LocalTime;
      dhuhr: LocalTime;
      asr: LocalTime;
      maghrib: LocalTime;
      isha: LocalTime;
    };
  }[];
  /**
   * Aggregated counts only. cases_field is the number of those cases classified as field work with rule_set_version; cases_total minus cases_field is the remote_inferred share.
   */
  history: {
    records: {
      sub_zone_id: Uuid;
      interval_start: string;
      cases_total: number;
      cases_field: number;
    }[];
    /**
     * Optional older history at a coarser grain, so years of history fit one request. Each period is hourly (60) or daily (1440) and must not overlap the 15-minute records.
     */
    aggregated_records?: {
      sub_zone_id: Uuid;
      period_start: string;
      period_minutes: 60 | 1440;
      cases_total: number;
      cases_field: number;
    }[];
    /**
     * Optional case counts per micro-cell (a geohash cell inside a sub-zone) by hour of day and day group. Counts only: never case coordinates.
     */
    location_records?: {
      sub_zone_id: Uuid;
      cell_id: CellId;
      hour: number;
      day_group: DayGroup;
      cases: number;
    }[];
  };
  /**
   * Optional daily weather per city, from a live feed or an imported file. Fields that are unknown are omitted.
   */
  weather?: {
    city_id: Uuid;
    date: string;
    rain_mm?: number;
    dust_event?: boolean;
    max_temp_c?: number;
    visibility_km?: number;
    source?: string;
  }[];
  /**
   * Optional daily traffic congestion per city, from a feed, an imported file or a SYNTHETIC series. congestion_index is the day's congestion against a typical day for that city (1.0 typical, 1.2 or more is a heavy day). Days that are unknown are omitted.
   */
  traffic?: {
    city_id: Uuid;
    date: string;
    congestion_index: number;
    source?: string;
  }[];
}
