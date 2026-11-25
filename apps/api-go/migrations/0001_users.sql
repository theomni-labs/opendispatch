-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- signed-in accounts and their assigned role
CREATE TABLE "users" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  keycloak_subject text,
  email text NOT NULL,
  display_name text NOT NULL,
  assigned_role text NOT NULL,
  zone_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL,
  is_emergency_admin boolean NOT NULL DEFAULT false,
  last_sign_in_at timestamptz,
  preferred_locale text NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT users_tenant_email_key UNIQUE (tenant_id, email)
);

-- RLS shape from policy.ts
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "users" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
