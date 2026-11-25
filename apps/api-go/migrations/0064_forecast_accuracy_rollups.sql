-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- rolling forecast accuracy per zone
CREATE TABLE "forecast_accuracy_rollups" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  zone_id uuid NOT NULL,
  window_start date NOT NULL,
  window_end date NOT NULL,
  window_days integer NOT NULL,
  dimension text NOT NULL,
  bucket smallint NOT NULL,
  days integer NOT NULL,
  forecast_sum double precision NOT NULL,
  actual_sum bigint NOT NULL,
  abs_error_sum double precision NOT NULL,
  ape_sum double precision NOT NULL,
  ape_count integer NOT NULL,
  data_sources text[] NOT NULL,
  illustrative boolean NOT NULL,
  computed_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT forecast_accuracy_rollups_bucket_key UNIQUE (tenant_id, zone_id, dimension, bucket),
  CONSTRAINT forecast_accuracy_rollups_zone_id_fkey FOREIGN KEY (tenant_id, zone_id) REFERENCES "zones" (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT forecast_accuracy_rollups_data_source_check CHECK (data_source IN ('SYNTHETIC', 'IMPORTED', 'LIVE')),
  CONSTRAINT forecast_accuracy_rollups_data_sources_check CHECK (
    cardinality(data_sources) >= 1 AND data_sources <@ ARRAY['SYNTHETIC', 'IMPORTED', 'LIVE']::text[]),
  CONSTRAINT forecast_accuracy_rollups_dimension_check CHECK (
    (dimension = 'zone' AND bucket = 0) OR (dimension = 'hour' AND bucket BETWEEN 0 AND 23) OR (dimension = 'weekday' AND bucket BETWEEN 0 AND 6)),
  CONSTRAINT forecast_accuracy_rollups_window_check CHECK (window_days BETWEEN 1 AND 366 AND window_end >= window_start),
  CONSTRAINT forecast_accuracy_rollups_sums_check CHECK (
    days >= 0 AND forecast_sum >= 0 AND actual_sum >= 0 AND abs_error_sum >= 0 AND ape_sum >= 0 AND ape_count >= 0)
);
CREATE INDEX forecast_accuracy_rollups_tenant_window_idx ON "forecast_accuracy_rollups" (tenant_id, window_end);

ALTER TABLE "forecast_accuracy_rollups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "forecast_accuracy_rollups" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "forecast_accuracy_rollups" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
