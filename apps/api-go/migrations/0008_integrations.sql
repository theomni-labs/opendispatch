-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- external data source connections
CREATE TABLE "integrations" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  kind text NOT NULL,
  name_en text NOT NULL,
  direction text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  endpoint_label text,
  credential_ref text,
  health text NOT NULL,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_message text,
  fallback_timeout_seconds int,
  PRIMARY KEY (tenant_id, id)
);

-- RLS shape from policy.ts
ALTER TABLE "integrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integrations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "integrations" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
