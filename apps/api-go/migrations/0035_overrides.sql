-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- roster overrides; needs rosters + assignments
CREATE TABLE "overrides" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  roster_id uuid,
  roster_assignment_id uuid,
  change_type text NOT NULL,
  reason_code text NOT NULL,
  note text,
  before jsonb,
  after jsonb,
  status text NOT NULL,
  decided_by_user_id uuid,
  decided_at timestamptz,
  decision_note text,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT overrides_roster_id_fkey FOREIGN KEY (tenant_id, roster_id) REFERENCES "rosters" (tenant_id, id),
  CONSTRAINT overrides_roster_assignment_id_fkey FOREIGN KEY (tenant_id, roster_assignment_id) REFERENCES "roster_assignments" (tenant_id, id),
  CONSTRAINT overrides_decided_by_user_id_fkey FOREIGN KEY (tenant_id, decided_by_user_id) REFERENCES "users" (tenant_id, id)
);

-- RLS shape from policy.ts
ALTER TABLE "overrides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "overrides" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "overrides" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
