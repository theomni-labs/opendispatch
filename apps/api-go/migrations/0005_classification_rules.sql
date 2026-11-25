-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- field vs remote classification rule headers
CREATE TABLE "classification_rules" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  rule_code text NOT NULL,
  name_en text NOT NULL,
  name_ar text,
  status text NOT NULL,
  active_version int,
  source_note text,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT classification_rules_tenant_rule_code_key UNIQUE (tenant_id, rule_code)
);

-- RLS shape from policy.ts
ALTER TABLE "classification_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "classification_rules" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "classification_rules" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
