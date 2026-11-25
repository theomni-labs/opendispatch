-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- API clients: the secret itself is never stored, only the last four characters as a hint
CREATE TABLE "api_clients" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  name text NOT NULL,
  scopes text[] NOT NULL,
  is_revoked boolean NOT NULL DEFAULT false,
  secret_hint text NOT NULL,
  last_used_at timestamptz,
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX api_clients_tenant_created_idx ON "api_clients" (tenant_id, created_at);

-- RLS shape from policy.ts
ALTER TABLE "api_clients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_clients" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "api_clients" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
