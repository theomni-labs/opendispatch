-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- versioned classification rule conditions
CREATE TABLE "rule_versions" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  rule_id uuid NOT NULL,
  rule_code text NOT NULL,
  version int NOT NULL,
  condition jsonb NOT NULL,
  condition_text_en text NOT NULL,
  outcome text NOT NULL,
  status text NOT NULL,
  effective_from date,
  effective_to date,
  submitted_at timestamptz,
  decided_at timestamptz,
  decided_by_user_id uuid,
  decision_note text,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT rule_versions_tenant_rule_version_key UNIQUE (tenant_id, rule_id, version),
  CONSTRAINT rule_versions_rule_id_fkey FOREIGN KEY (tenant_id, rule_id) REFERENCES "classification_rules" (tenant_id, id),
  CONSTRAINT rule_versions_decided_by_user_id_fkey FOREIGN KEY (tenant_id, decided_by_user_id) REFERENCES "users" (tenant_id, id)
);

-- RLS shape from policy.ts
ALTER TABLE "rule_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rule_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "rule_versions" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
