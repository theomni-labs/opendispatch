-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- deliveries made in the same second keep the order they were written in
ALTER TABLE "webhook_deliveries" ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY;
CREATE INDEX webhook_deliveries_tenant_seq_idx ON "webhook_deliveries" (tenant_id, created_at, seq);
