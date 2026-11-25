-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- import row issues; case_id is not a FK
CREATE TABLE "data_quality_issues" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  import_job_id uuid NOT NULL,
  case_id uuid,
  row_number int NOT NULL,
  field text,
  issue_type text NOT NULL,
  severity text NOT NULL,
  status text NOT NULL,
  message text NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT data_quality_issues_import_job_id_fkey FOREIGN KEY (tenant_id, import_job_id) REFERENCES "import_jobs" (tenant_id, id)
);

-- RLS shape from policy.ts
ALTER TABLE "data_quality_issues" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_quality_issues" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "data_quality_issues" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
