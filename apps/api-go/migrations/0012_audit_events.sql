-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- audit log; actor/entity ids are not FKs
CREATE TABLE "audit_events" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  occurred_at timestamptz NOT NULL,
  actor_type text NOT NULL,
  actor_user_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  outcome text NOT NULL,
  summary_en text NOT NULL,
  correlation_id text,
  detail jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX audit_events_tenant_occurred_idx ON "audit_events" (tenant_id, occurred_at DESC);
CREATE INDEX audit_events_tenant_entity_idx ON "audit_events" (tenant_id, entity_type, entity_id);

-- RLS shape from policy.ts
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_events" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
