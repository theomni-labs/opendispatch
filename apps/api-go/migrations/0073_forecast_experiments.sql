-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- tracked model runs
CREATE TABLE "forecast_experiments" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  kind text NOT NULL,
  trigger text NOT NULL,
  status text NOT NULL,
  model_version text NOT NULL,
  challenger_model text,
  dataset_snapshot_id text,
  forecast_run_id uuid,
  params jsonb NOT NULL DEFAULT '{}',
  metrics jsonb NOT NULL DEFAULT '{}',
  illustrative boolean NOT NULL DEFAULT true,
  started_at timestamptz,
  finished_at timestamptz,
  error_class text,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT forecast_experiments_data_source_check CHECK (data_source IN ('SYNTHETIC', 'IMPORTED', 'LIVE')),
  CONSTRAINT forecast_experiments_kind_check CHECK (kind IN ('backtest', 'challenger', 'retrain')),
  CONSTRAINT forecast_experiments_trigger_check CHECK (trigger IN ('manual', 'schedule', 'degradation')),
  CONSTRAINT forecast_experiments_status_check CHECK (status IN ('running', 'succeeded', 'failed'))
);
CREATE INDEX forecast_experiments_tenant_created_idx ON "forecast_experiments" (tenant_id, created_at DESC);

ALTER TABLE "forecast_experiments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "forecast_experiments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "forecast_experiments" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- data versioning: the history a run was fit on
ALTER TABLE "forecast_runs" ADD COLUMN dataset_snapshot_id text;
