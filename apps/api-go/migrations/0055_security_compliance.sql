-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- security and compliance: control evidence and support access grants
CREATE TABLE "control_evidence" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  framework text NOT NULL,
  control_ref text NOT NULL,
  title_en text NOT NULL,
  status text NOT NULL,
  evidence_note text,
  reviewed_at timestamptz,
  PRIMARY KEY (tenant_id, id)
);

CREATE UNIQUE INDEX control_evidence_tenant_ref_idx ON "control_evidence" (tenant_id, control_ref);

-- RLS shape from policy.ts
ALTER TABLE "control_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "control_evidence" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "control_evidence" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE TABLE "support_access_events" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  granted_by_user_id uuid NOT NULL,
  reason text NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX support_access_events_tenant_started_idx ON "support_access_events" (tenant_id, started_at);

-- RLS shape from policy.ts
ALTER TABLE "support_access_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "support_access_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "support_access_events" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
