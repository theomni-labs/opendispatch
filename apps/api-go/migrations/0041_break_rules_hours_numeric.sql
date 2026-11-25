-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- after_consecutive_hours is a number, not int.
ALTER TABLE "break_rules" ALTER COLUMN after_consecutive_hours TYPE double precision;
