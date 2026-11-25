-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- what-if simulation scenario definitions
CREATE TABLE "scenarios" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  name text NOT NULL,
  base_date date NOT NULL,
  zone_ids uuid[] NOT NULL DEFAULT '{}',
  adjustments jsonb NOT NULL,
  status text NOT NULL,
  last_run_at timestamptz,
  PRIMARY KEY (tenant_id, id)
);

-- RLS shape from policy.ts
ALTER TABLE "scenarios" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scenarios" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "scenarios" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
