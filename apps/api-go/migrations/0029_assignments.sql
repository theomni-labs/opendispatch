-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- one assignment per case
CREATE TABLE "assignments" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  case_id uuid NOT NULL,
  agent_id uuid,
  decided_at timestamptz NOT NULL,
  source text NOT NULL,
  stage text NOT NULL,
  state text NOT NULL,
  reason_code text,
  reason_note text,
  estimated_arrival_at timestamptz,
  estimated_travel_seconds int,
  decided_by_user_id uuid,
  model_version text,
  extra jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT assignments_tenant_case_id_key UNIQUE (tenant_id, case_id),
  CONSTRAINT assignments_case_id_fkey FOREIGN KEY (tenant_id, case_id) REFERENCES "cases" (tenant_id, id),
  CONSTRAINT assignments_agent_id_fkey FOREIGN KEY (tenant_id, agent_id) REFERENCES "agents" (tenant_id, id),
  CONSTRAINT assignments_decided_by_user_id_fkey FOREIGN KEY (tenant_id, decided_by_user_id) REFERENCES "users" (tenant_id, id)
);

-- RLS shape from policy.ts
ALTER TABLE "assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "assignments" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
