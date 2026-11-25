-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- A header-level issue (e.g. a missing required column) names no row.
ALTER TABLE "data_quality_issues" ALTER COLUMN row_number DROP NOT NULL;
