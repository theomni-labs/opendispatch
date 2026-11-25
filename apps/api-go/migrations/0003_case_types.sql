-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- accident case type reference list
CREATE TABLE "case_types" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  external_id text,
  name_en text NOT NULL,
  name_ar text,
  is_active boolean NOT NULL DEFAULT true,
  extra jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id)
);

-- RLS shape from policy.ts
ALTER TABLE "case_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "case_types" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "case_types" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
