-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- The customer data import job runs
CREATE TABLE "import_jobs" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  file_name text NOT NULL,
  mapping_version text NOT NULL,
  status text NOT NULL,
  row_count int,
  issue_count int,
  error_count int,
  warning_count int,
  storage_ref text,
  validated_at timestamptz,
  cut_over_at timestamptz,
  PRIMARY KEY (tenant_id, id)
);

-- RLS shape from policy.ts
ALTER TABLE "import_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_jobs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "import_jobs" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
