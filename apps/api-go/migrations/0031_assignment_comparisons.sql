-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- shadow-mode OpenDispatch vs the customer comparison per case
CREATE TABLE "assignment_comparisons" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  case_id uuid NOT NULL,
  zone_id uuid,
  compared_at timestamptz NOT NULL,
  same_agent boolean NOT NULL,
  opendispatch jsonb NOT NULL,
  customer jsonb NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT assignment_comparisons_case_id_fkey FOREIGN KEY (tenant_id, case_id) REFERENCES "cases" (tenant_id, id),
  CONSTRAINT assignment_comparisons_zone_id_fkey FOREIGN KEY (tenant_id, zone_id) REFERENCES "zones" (tenant_id, id)
);

-- RLS shape from policy.ts
ALTER TABLE "assignment_comparisons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assignment_comparisons" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "assignment_comparisons" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
