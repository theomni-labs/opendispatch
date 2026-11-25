-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- one row per delivery attempt series of a webhook; deleting the webhook deletes its log
CREATE TABLE "webhook_deliveries" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  webhook_id uuid NOT NULL,
  event_type text NOT NULL,
  status text NOT NULL,
  http_status int NOT NULL,
  attempted_at timestamptz NOT NULL,
  attempt_count int NOT NULL,
  error_message text,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT webhook_deliveries_webhook_id_fkey FOREIGN KEY (tenant_id, webhook_id) REFERENCES "webhooks" (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX webhook_deliveries_tenant_webhook_idx ON "webhook_deliveries" (tenant_id, webhook_id, attempted_at);

-- RLS shape from policy.ts
ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "webhook_deliveries" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
