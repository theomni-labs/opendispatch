-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false
-- contract: a unique key is relaxed to a partial one; the previous release's writes still pass

-- a case keeps its decision history (recommended, overridden, superseded); only one assignment per case may be active
ALTER TABLE "assignments" DROP CONSTRAINT assignments_tenant_case_id_key;
CREATE UNIQUE INDEX assignments_tenant_case_active_idx ON "assignments" (tenant_id, case_id) WHERE state = 'assigned';
CREATE INDEX assignments_tenant_case_idx ON "assignments" (tenant_id, case_id, decided_at);

-- the reason of an override is part of its event, as the contract says
ALTER TABLE "assignment_events" ADD COLUMN reason_code text;
