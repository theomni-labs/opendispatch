-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- sick days per zone and month
CREATE TABLE "sick_leave_history" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  zone_id uuid NOT NULL,
  month date NOT NULL,
  agents int NOT NULL,
  sick_days double precision NOT NULL,
  extra jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT sick_leave_history_month_check CHECK (extract(day FROM month) = 1),
  CONSTRAINT sick_leave_history_counts_check CHECK (agents >= 0 AND sick_days >= 0),
  CONSTRAINT sick_leave_history_zone_month_key UNIQUE (tenant_id, zone_id, month),
  CONSTRAINT sick_leave_history_zone_id_fkey FOREIGN KEY (tenant_id, zone_id) REFERENCES "zones" (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX sick_leave_history_tenant_month_idx ON "sick_leave_history" (tenant_id, month);

ALTER TABLE "sick_leave_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sick_leave_history" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sick_leave_history" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- time and attendance: actual on-duty spans
CREATE TABLE "attendance_spans" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  agent_id uuid NOT NULL,
  work_date date NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  extra jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT attendance_spans_window_check CHECK (ended_at > started_at),
  CONSTRAINT attendance_spans_agent_id_fkey FOREIGN KEY (tenant_id, agent_id) REFERENCES "agents" (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX attendance_spans_tenant_started_idx ON "attendance_spans" (tenant_id, started_at);
CREATE INDEX attendance_spans_tenant_agent_date_idx ON "attendance_spans" (tenant_id, agent_id, work_date);

ALTER TABLE "attendance_spans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_spans" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "attendance_spans" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
