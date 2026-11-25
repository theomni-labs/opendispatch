-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- agent leave requests
CREATE TABLE "leave_requests" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  agent_id uuid NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  leave_type text NOT NULL,
  status text NOT NULL,
  requested_at timestamptz NOT NULL,
  decided_at timestamptz,
  decided_by_user_id uuid,
  decision_note text,
  note text,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT leave_requests_agent_id_fkey FOREIGN KEY (tenant_id, agent_id) REFERENCES "agents" (tenant_id, id),
  CONSTRAINT leave_requests_decided_by_user_id_fkey FOREIGN KEY (tenant_id, decided_by_user_id) REFERENCES "users" (tenant_id, id)
);

-- RLS shape from policy.ts
ALTER TABLE "leave_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "leave_requests" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
