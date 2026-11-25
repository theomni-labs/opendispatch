-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- one real table; fixtures split it per zone
CREATE TABLE "forecast_values" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  forecast_run_id uuid NOT NULL,
  zone_id uuid NOT NULL,
  sub_zone_id uuid,
  interval_start timestamptz NOT NULL,
  interval_index int NOT NULL,
  low int,
  expected double precision,
  high double precision,
  field_expected double precision,
  remote_inferred_expected double precision,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT forecast_values_forecast_run_id_fkey FOREIGN KEY (tenant_id, forecast_run_id) REFERENCES "forecast_runs" (tenant_id, id),
  CONSTRAINT forecast_values_zone_id_fkey FOREIGN KEY (tenant_id, zone_id) REFERENCES "zones" (tenant_id, id),
  CONSTRAINT forecast_values_sub_zone_id_fkey FOREIGN KEY (tenant_id, sub_zone_id) REFERENCES "sub_zones" (tenant_id, id)
);

CREATE INDEX forecast_values_tenant_run_zone_idx
  ON "forecast_values" (tenant_id, forecast_run_id, zone_id, interval_start);

-- RLS shape from policy.ts
ALTER TABLE "forecast_values" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "forecast_values" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "forecast_values" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
