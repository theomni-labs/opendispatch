-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- shift patterns, normal and Ramadan hours
CREATE TABLE "shift_patterns" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  code text NOT NULL,
  name_en text NOT NULL,
  name_ar text,
  kind text NOT NULL,
  normal jsonb NOT NULL,
  ramadan jsonb NOT NULL,
  break_rule_id uuid,
  status text NOT NULL,
  extra jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT shift_patterns_tenant_code_key UNIQUE (tenant_id, code),
  CONSTRAINT shift_patterns_break_rule_id_fkey FOREIGN KEY (tenant_id, break_rule_id) REFERENCES "break_rules" (tenant_id, id)
);

-- RLS shape from policy.ts
ALTER TABLE "shift_patterns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shift_patterns" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "shift_patterns" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
