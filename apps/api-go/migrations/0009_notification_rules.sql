-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- which events notify which roles, on which channels
CREATE TABLE "notification_rules" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  event_type text NOT NULL,
  channels text[] NOT NULL,
  recipient_roles text[] NOT NULL,
  severity text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, id)
);

-- RLS shape from policy.ts
ALTER TABLE "notification_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_rules" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notification_rules" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
