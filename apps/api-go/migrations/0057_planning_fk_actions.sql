-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false
-- contract: foreign keys get delete actions; the previous release's writes still pass

-- a roster rebuild replaces its lines: an override keeps its before and after, and loses only the link to the replaced line
ALTER TABLE "overrides" DROP CONSTRAINT overrides_roster_assignment_id_fkey;
ALTER TABLE "overrides" ADD CONSTRAINT overrides_roster_assignment_id_fkey FOREIGN KEY (tenant_id, roster_assignment_id)
  REFERENCES "roster_assignments" (tenant_id, id) ON DELETE SET NULL (roster_assignment_id);

-- deleting a scenario deletes its simulation runs and their results
ALTER TABLE "simulation_runs" DROP CONSTRAINT simulation_runs_scenario_id_fkey;
ALTER TABLE "simulation_runs" ADD CONSTRAINT simulation_runs_scenario_id_fkey FOREIGN KEY (tenant_id, scenario_id)
  REFERENCES "scenarios" (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE "simulation_results" DROP CONSTRAINT simulation_results_simulation_run_id_fkey;
ALTER TABLE "simulation_results" ADD CONSTRAINT simulation_results_simulation_run_id_fkey FOREIGN KEY (tenant_id, simulation_run_id)
  REFERENCES "simulation_runs" (tenant_id, id) ON DELETE CASCADE;
