-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- Keycloak sync state per provider
ALTER TABLE "identity_providers" ADD COLUMN sync_status text;
ALTER TABLE "identity_providers" ADD COLUMN last_sync_at timestamptz;
ALTER TABLE "identity_providers" ADD COLUMN last_sync_error text;
ALTER TABLE "identity_providers" ADD CONSTRAINT identity_providers_sync_status_check
  CHECK (sync_status IS NULL OR sync_status IN ('synced', 'failed', 'not_configured'));
