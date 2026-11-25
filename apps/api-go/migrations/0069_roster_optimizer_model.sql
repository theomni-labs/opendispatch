-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- the optimizer model that ran, and its proof
ALTER TABLE "rosters"
  ADD COLUMN optimizer_model text CONSTRAINT rosters_optimizer_model_check CHECK (char_length(optimizer_model) <= 64),
  ADD COLUMN solver_status text CONSTRAINT rosters_solver_status_check CHECK (solver_status IN ('optimal', 'feasible', 'heuristic'));
