-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- ordinary table, no materialized view
CREATE TABLE "dashboard_rollups" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  level text NOT NULL,
  scope_id uuid,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  cases_total int,
  cases_field int,
  cases_remote_inferred int,
  forecast_expected_total double precision,
  from_registration jsonb,
  from_assignment jsonb,
  primary_clock_start text,
  agents_on_duty int,
  gap_intervals jsonb,
  surplus_intervals jsonb,
  illustrative boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, id)
);

-- RLS shape from policy.ts
ALTER TABLE "dashboard_rollups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dashboard_rollups" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "dashboard_rollups" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
