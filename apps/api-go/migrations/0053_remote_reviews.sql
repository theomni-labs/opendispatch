-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- reviewer assignments of the remote queue, one per case
CREATE TABLE "remote_reviews" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  case_id uuid NOT NULL,
  reviewer_id uuid NOT NULL,
  review_started_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT remote_reviews_case_id_fkey FOREIGN KEY (tenant_id, case_id) REFERENCES "cases" (tenant_id, id),
  CONSTRAINT remote_reviews_reviewer_id_fkey FOREIGN KEY (tenant_id, reviewer_id) REFERENCES "agents" (tenant_id, id)
);

CREATE UNIQUE INDEX remote_reviews_tenant_case_idx ON "remote_reviews" (tenant_id, case_id);

-- RLS shape from policy.ts
ALTER TABLE "remote_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "remote_reviews" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "remote_reviews" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
