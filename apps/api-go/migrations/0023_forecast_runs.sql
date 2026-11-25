-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- forecast run headers; model_version is text
CREATE TABLE "forecast_runs" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  model_version text NOT NULL,
  engine_version text,
  rule_set_version text,
  status text NOT NULL,
  horizon_start_date date NOT NULL,
  horizon_days int NOT NULL,
  range_coverage double precision,
  illustrative boolean NOT NULL DEFAULT true,
  input_data_sources text[] NOT NULL DEFAULT '{}',
  started_at timestamptz,
  finished_at timestamptz,
  error_message text,
  PRIMARY KEY (tenant_id, id)
);

-- RLS shape from policy.ts
ALTER TABLE "forecast_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "forecast_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "forecast_runs" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
