-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- ordinary table, no materialized view
CREATE TABLE "productivity_rollups" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  group_by text NOT NULL,
  zone_id uuid,
  agent_id uuid,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  cases_handled int,
  median_assigned_to_arrived_seconds int,
  median_registered_to_arrived_seconds int,
  median_time_on_scene_seconds int,
  utilisation double precision,
  illustrative boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT productivity_rollups_zone_id_fkey FOREIGN KEY (tenant_id, zone_id) REFERENCES "zones" (tenant_id, id),
  CONSTRAINT productivity_rollups_agent_id_fkey FOREIGN KEY (tenant_id, agent_id) REFERENCES "agents" (tenant_id, id)
);

-- RLS shape from policy.ts
ALTER TABLE "productivity_rollups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "productivity_rollups" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "productivity_rollups" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
