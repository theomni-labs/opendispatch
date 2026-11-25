-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- what-if simulation run headers
CREATE TABLE "simulation_runs" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  roster_id uuid,
  scenario_id uuid,
  run_date date NOT NULL,
  assignment_policy text NOT NULL,
  primary_clock_start text NOT NULL,
  threshold_seconds int NOT NULL,
  status text NOT NULL,
  illustrative boolean NOT NULL DEFAULT true,
  engine_version text,
  finished_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT simulation_runs_roster_id_fkey FOREIGN KEY (tenant_id, roster_id) REFERENCES "rosters" (tenant_id, id),
  CONSTRAINT simulation_runs_scenario_id_fkey FOREIGN KEY (tenant_id, scenario_id) REFERENCES "scenarios" (tenant_id, id)
);

-- RLS shape from policy.ts
ALTER TABLE "simulation_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "simulation_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "simulation_runs" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
