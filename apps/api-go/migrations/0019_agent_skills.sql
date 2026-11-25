-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- skill codes held by an agent
CREATE TABLE "agent_skills" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  agent_id uuid NOT NULL,
  skill_code text NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT agent_skills_tenant_agent_skill_key UNIQUE (tenant_id, agent_id, skill_code),
  CONSTRAINT agent_skills_agent_id_fkey FOREIGN KEY (tenant_id, agent_id) REFERENCES "agents" (tenant_id, id)
);

-- RLS shape from policy.ts
ALTER TABLE "agent_skills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_skills" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "agent_skills" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
