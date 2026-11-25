-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- per-zone/interval simulation output
CREATE TABLE "simulation_results" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  simulation_run_id uuid NOT NULL,
  zone_id uuid,
  interval_start timestamptz,
  case_count int,
  field_case_count int,
  from_registration jsonb,
  from_assignment jsonb,
  median_assigned_to_arrived_seconds int,
  p90_assigned_to_arrived_seconds int,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT simulation_results_simulation_run_id_fkey FOREIGN KEY (tenant_id, simulation_run_id) REFERENCES "simulation_runs" (tenant_id, id),
  CONSTRAINT simulation_results_zone_id_fkey FOREIGN KEY (tenant_id, zone_id) REFERENCES "zones" (tenant_id, id)
);

-- RLS shape from policy.ts
ALTER TABLE "simulation_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "simulation_results" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "simulation_results" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
