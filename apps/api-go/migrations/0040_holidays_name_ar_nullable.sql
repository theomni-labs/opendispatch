-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- Contract: name_ar is present but may be null.
ALTER TABLE "holidays" ALTER COLUMN name_ar DROP NOT NULL;
