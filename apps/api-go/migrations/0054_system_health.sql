-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- system health: job runs and diagnostics bundles
CREATE TABLE "job_runs" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  job_name text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms int,
  message text,
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX job_runs_tenant_started_idx ON "job_runs" (tenant_id, started_at);

-- RLS shape from policy.ts
ALTER TABLE "job_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "job_runs" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE TABLE "diagnostics_bundles" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  generated_at timestamptz NOT NULL,
  generated_by_user_id uuid NOT NULL,
  size_bytes int NOT NULL,
  personal_data_removed boolean NOT NULL,
  includes jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX diagnostics_bundles_tenant_generated_idx ON "diagnostics_bundles" (tenant_id, generated_at);

-- RLS shape from policy.ts
ALTER TABLE "diagnostics_bundles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "diagnostics_bundles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "diagnostics_bundles" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
