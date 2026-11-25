-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- assignment timeline events; actor_user_id not a FK
CREATE TABLE "assignment_events" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  assignment_id uuid NOT NULL,
  case_id uuid NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  source text NOT NULL,
  actor_user_id uuid,
  note text,
  detail jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT assignment_events_assignment_id_fkey FOREIGN KEY (tenant_id, assignment_id) REFERENCES "assignments" (tenant_id, id),
  CONSTRAINT assignment_events_case_id_fkey FOREIGN KEY (tenant_id, case_id) REFERENCES "cases" (tenant_id, id)
);

-- RLS shape from policy.ts
ALTER TABLE "assignment_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assignment_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "assignment_events" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
