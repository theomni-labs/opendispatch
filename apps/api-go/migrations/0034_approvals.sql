-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- generic approval; subject_id is polymorphic
CREATE TABLE "approvals" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  status text NOT NULL,
  summary_en text NOT NULL,
  requested_at timestamptz NOT NULL,
  decided_at timestamptz,
  decided_by_user_id uuid,
  decision_note text,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT approvals_decided_by_user_id_fkey FOREIGN KEY (tenant_id, decided_by_user_id) REFERENCES "users" (tenant_id, id)
);

CREATE INDEX approvals_tenant_subject_idx ON "approvals" (tenant_id, subject_type, subject_id);

-- RLS shape from policy.ts
ALTER TABLE "approvals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approvals" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "approvals" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
