-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- hour of day on company totals
CREATE TABLE "forecast_accuracy_hour_totals" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  window_start date NOT NULL,
  window_end date NOT NULL,
  window_days integer NOT NULL,
  bucket smallint NOT NULL,
  zones integer NOT NULL,
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
  CONSTRAINT forecast_accuracy_hour_totals_bucket_key UNIQUE (tenant_id, bucket),
  CONSTRAINT forecast_accuracy_hour_totals_data_source_check CHECK (data_source IN ('SYNTHETIC', 'IMPORTED', 'LIVE')),
  CONSTRAINT forecast_accuracy_hour_totals_data_sources_check CHECK (
    cardinality(data_sources) >= 1 AND data_sources <@ ARRAY['SYNTHETIC', 'IMPORTED', 'LIVE']::text[]),
  CONSTRAINT forecast_accuracy_hour_totals_bucket_check CHECK (bucket BETWEEN 0 AND 23),
  CONSTRAINT forecast_accuracy_hour_totals_window_check CHECK (window_days BETWEEN 1 AND 366 AND window_end >= window_start),
  CONSTRAINT forecast_accuracy_hour_totals_sums_check CHECK (
    zones >= 1 AND days >= 0 AND forecast_sum >= 0 AND actual_sum >= 0 AND abs_error_sum >= 0 AND ape_sum >= 0 AND ape_count >= 0)
);
CREATE INDEX forecast_accuracy_hour_totals_tenant_window_idx ON "forecast_accuracy_hour_totals" (tenant_id, window_end);

ALTER TABLE "forecast_accuracy_hour_totals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "forecast_accuracy_hour_totals" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "forecast_accuracy_hour_totals" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
