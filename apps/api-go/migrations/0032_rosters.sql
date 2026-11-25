-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- daily roster headers per zone
CREATE TABLE "rosters" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  zone_id uuid NOT NULL,
  roster_date date NOT NULL,
  status text NOT NULL,
  forecast_run_id uuid,
  planning_level text NOT NULL,
  optimizer_status text,
  engine_version text,
  illustrative boolean NOT NULL DEFAULT true,
  gap_count int,
  surplus_count int,
  approved_by_user_id uuid,
  approved_at timestamptz,
  published_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT rosters_zone_id_fkey FOREIGN KEY (tenant_id, zone_id) REFERENCES "zones" (tenant_id, id),
  CONSTRAINT rosters_forecast_run_id_fkey FOREIGN KEY (tenant_id, forecast_run_id) REFERENCES "forecast_runs" (tenant_id, id),
  CONSTRAINT rosters_approved_by_user_id_fkey FOREIGN KEY (tenant_id, approved_by_user_id) REFERENCES "users" (tenant_id, id)
);

-- RLS shape from policy.ts
ALTER TABLE "rosters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rosters" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "rosters" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
