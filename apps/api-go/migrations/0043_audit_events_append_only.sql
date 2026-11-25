-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- audit rows: entity_id is any text (contract), seq is append order, rows are append only
ALTER TABLE "audit_events" ALTER COLUMN entity_id TYPE text USING entity_id::text;
ALTER TABLE "audit_events" ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY;

CREATE FUNCTION audit_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'audit_events is append only' USING ERRCODE = 'restrict_violation';
END;
$fn$;

CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
