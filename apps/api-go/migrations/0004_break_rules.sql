-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- mandatory break policy rules
CREATE TABLE "break_rules" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  code text NOT NULL,
  name_en text NOT NULL,
  name_ar text,
  break_minutes int NOT NULL,
  after_consecutive_hours int NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT break_rules_tenant_code_key UNIQUE (tenant_id, code)
);

-- RLS shape from policy.ts
ALTER TABLE "break_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "break_rules" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "break_rules" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
