-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- distinct case sources by skip scan
CREATE INDEX cases_tenant_data_source_idx ON "cases" (tenant_id, data_source);
