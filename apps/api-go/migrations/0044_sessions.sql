-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- signed-in sessions; the cookie holds a random token and only its hash is stored
CREATE TABLE "sessions" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL,
  token_hash bytea NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT sessions_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES "users" (tenant_id, id)
);

CREATE UNIQUE INDEX sessions_tenant_token_hash_idx ON "sessions" (tenant_id, token_hash);
CREATE INDEX sessions_tenant_user_idx ON "sessions" (tenant_id, user_id, created_at);

-- RLS shape from policy.ts
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sessions" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
