-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- daily weather per city (public data)
CREATE TABLE "weather_days" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  city_id uuid NOT NULL,
  date date NOT NULL,
  rain_mm double precision,
  dust_event boolean,
  max_temp_c double precision,
  visibility_km double precision,
  source text NOT NULL,
  fetched_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT weather_days_city_date_key UNIQUE (tenant_id, city_id, date),
  CONSTRAINT weather_days_city_id_fkey FOREIGN KEY (tenant_id, city_id) REFERENCES "cities" (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT weather_days_data_source_check CHECK (data_source IN ('SYNTHETIC', 'IMPORTED', 'LIVE', 'PUBLIC_OPEN_DATA')),
  CONSTRAINT weather_days_rain_check CHECK (rain_mm IS NULL OR (rain_mm >= 0 AND rain_mm <= 1000)),
  CONSTRAINT weather_days_temp_check CHECK (max_temp_c IS NULL OR (max_temp_c >= -20 AND max_temp_c <= 60)),
  CONSTRAINT weather_days_visibility_check CHECK (visibility_km IS NULL OR (visibility_km >= 0 AND visibility_km <= 1000)),
  CONSTRAINT weather_days_source_check CHECK (length(source) BETWEEN 1 AND 64)
);
CREATE INDEX weather_days_tenant_date_idx ON "weather_days" (tenant_id, date);

ALTER TABLE "weather_days" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "weather_days" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "weather_days" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
