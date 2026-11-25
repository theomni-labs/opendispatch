-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- deleting cases checks these by index, not scan
CREATE INDEX assignment_events_tenant_case_idx ON "assignment_events" (tenant_id, case_id);
CREATE INDEX assignment_comparisons_tenant_case_idx ON "assignment_comparisons" (tenant_id, case_id);
