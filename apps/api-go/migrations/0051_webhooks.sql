-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- outbound webhooks: the signing secret is never stored, only a four-character hint
CREATE TABLE "webhooks" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  name text NOT NULL,
  target_url text NOT NULL,
  event_types text[] NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  signing_secret_hint text NOT NULL,
  last_delivery_at timestamptz,
  last_status text,
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX webhooks_tenant_created_idx ON "webhooks" (tenant_id, created_at);

-- RLS shape from policy.ts
ALTER TABLE "webhooks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhooks" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "webhooks" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
