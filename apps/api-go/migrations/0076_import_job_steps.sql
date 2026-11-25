-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- background import steps
ALTER TABLE "import_jobs" ADD COLUMN step text;
ALTER TABLE "import_jobs" ADD COLUMN step_state text;
ALTER TABLE "import_jobs" ADD COLUMN step_started_at timestamptz;
ALTER TABLE "import_jobs" ADD COLUMN step_finished_at timestamptz;
ALTER TABLE "import_jobs" ADD COLUMN step_heartbeat_at timestamptz;
ALTER TABLE "import_jobs" ADD COLUMN step_rows_done bigint;
ALTER TABLE "import_jobs" ADD COLUMN step_rows_total bigint;
ALTER TABLE "import_jobs" ADD COLUMN step_error text;
ALTER TABLE "import_jobs" ADD COLUMN step_result jsonb;
ALTER TABLE "import_jobs" ADD CONSTRAINT import_jobs_step_check
  CHECK (step IS NULL OR step IN ('validate', 'compare', 'dry_run', 'cut_over', 'rollback'));
ALTER TABLE "import_jobs" ADD CONSTRAINT import_jobs_step_state_check
  CHECK (step_state IS NULL OR step_state IN ('running', 'succeeded', 'failed'));
