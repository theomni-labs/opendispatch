-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- last good answers of the batch engines, shared by the api and the worker
CREATE TABLE "engine_answers" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  engine text NOT NULL,
  scope_key text NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, engine, scope_key)
);
CREATE INDEX engine_answers_tenant_engine_updated_idx ON "engine_answers" (tenant_id, engine, updated_at);

ALTER TABLE "engine_answers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "engine_answers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "engine_answers" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
