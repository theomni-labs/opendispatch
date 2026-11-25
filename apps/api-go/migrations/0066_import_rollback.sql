-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- the import that last wrote a case (roll-back)
ALTER TABLE "cases" ADD COLUMN import_job_id uuid;
ALTER TABLE "cases" ADD CONSTRAINT cases_import_job_id_fkey FOREIGN KEY (tenant_id, import_job_id)
  REFERENCES "import_jobs" (tenant_id, id) ON DELETE SET NULL (import_job_id);
CREATE INDEX cases_tenant_import_job_idx ON "cases" (tenant_id, import_job_id) WHERE import_job_id IS NOT NULL;

-- a case's values before a cut-over updated it
CREATE TABLE "import_case_snapshots" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  import_job_id uuid NOT NULL,
  case_id uuid NOT NULL,
  previous jsonb NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT import_case_snapshots_import_job_id_fkey FOREIGN KEY (tenant_id, import_job_id) REFERENCES "import_jobs" (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT import_case_snapshots_case_id_fkey FOREIGN KEY (tenant_id, case_id) REFERENCES "cases" (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX import_case_snapshots_tenant_job_idx ON "import_case_snapshots" (tenant_id, import_job_id);
CREATE INDEX import_case_snapshots_tenant_case_idx ON "import_case_snapshots" (tenant_id, case_id);

-- RLS shape from policy.ts
ALTER TABLE "import_case_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_case_snapshots" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "import_case_snapshots" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
