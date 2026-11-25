-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- Keycloak group to role mapping rules
CREATE TABLE "role_mappings" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  identity_provider_id text,
  group_match text NOT NULL,
  group_match_type text NOT NULL,
  assigned_role text NOT NULL,
  zone_ids uuid[] NOT NULL DEFAULT '{}',
  priority int NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, id)
);

-- RLS shape from policy.ts
ALTER TABLE "role_mappings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_mappings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "role_mappings" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
