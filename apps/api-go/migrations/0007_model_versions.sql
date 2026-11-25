-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- forecaster model version registry
CREATE TABLE "model_versions" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  version text NOT NULL,
  status text NOT NULL,
  is_placeholder boolean NOT NULL,
  engine_version text,
  trained_at timestamptz,
  notes_en text,
  PRIMARY KEY (tenant_id, id)
);

-- RLS shape from policy.ts
ALTER TABLE "model_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "model_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "model_versions" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
