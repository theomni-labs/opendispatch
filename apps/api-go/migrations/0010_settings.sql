-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- generic per-tenant key/value settings store
CREATE TABLE "settings" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  key text NOT NULL,
  value text NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT settings_tenant_key_key UNIQUE (tenant_id, key)
);

-- RLS shape from policy.ts
ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "settings" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
