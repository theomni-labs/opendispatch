-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- annual leave entitlement
ALTER TABLE "agents" ADD COLUMN annual_leave_days integer;
ALTER TABLE "agents" ADD CONSTRAINT agents_annual_leave_days_check CHECK (annual_leave_days IS NULL OR (annual_leave_days >= 0 AND annual_leave_days <= 365));

-- shift patterns an agent may work; none: any
CREATE TABLE "agent_shift_eligibility" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  agent_id uuid NOT NULL,
  shift_pattern_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT agent_shift_eligibility_tenant_agent_pattern_key UNIQUE (tenant_id, agent_id, shift_pattern_id),
  CONSTRAINT agent_shift_eligibility_agent_id_fkey FOREIGN KEY (tenant_id, agent_id) REFERENCES "agents" (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT agent_shift_eligibility_shift_pattern_id_fkey FOREIGN KEY (tenant_id, shift_pattern_id) REFERENCES "shift_patterns" (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX agent_shift_eligibility_tenant_pattern_idx ON "agent_shift_eligibility" (tenant_id, shift_pattern_id);

ALTER TABLE "agent_shift_eligibility" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_shift_eligibility" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "agent_shift_eligibility" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
