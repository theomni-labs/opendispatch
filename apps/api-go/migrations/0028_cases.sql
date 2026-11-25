-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- one real table; fixtures split it per day
CREATE TABLE "cases" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  external_id text,
  case_number text NOT NULL,
  registered_at timestamptz NOT NULL,
  city_id uuid,
  zone_id uuid,
  sub_zone_id uuid,
  latitude double precision,
  longitude double precision,
  case_type_id uuid,
  parties_involved int,
  assigned_at timestamptz,
  arrived_at timestamptz,
  closed_at timestamptz,
  handling text NOT NULL,
  agent_id uuid,
  vehicle_id uuid,
  severity text,
  injury_present boolean,
  estimated_damage_sar numeric,
  on_scene_completed_at timestamptz,
  remote_review_at timestamptz,
  channel text,
  extra jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT cases_city_id_fkey FOREIGN KEY (tenant_id, city_id) REFERENCES "cities" (tenant_id, id),
  CONSTRAINT cases_zone_id_fkey FOREIGN KEY (tenant_id, zone_id) REFERENCES "zones" (tenant_id, id),
  CONSTRAINT cases_sub_zone_id_fkey FOREIGN KEY (tenant_id, sub_zone_id) REFERENCES "sub_zones" (tenant_id, id),
  CONSTRAINT cases_case_type_id_fkey FOREIGN KEY (tenant_id, case_type_id) REFERENCES "case_types" (tenant_id, id),
  CONSTRAINT cases_agent_id_fkey FOREIGN KEY (tenant_id, agent_id) REFERENCES "agents" (tenant_id, id),
  CONSTRAINT cases_vehicle_id_fkey FOREIGN KEY (tenant_id, vehicle_id) REFERENCES "vehicles" (tenant_id, id)
);

CREATE INDEX cases_tenant_registered_idx ON "cases" (tenant_id, registered_at);
CREATE INDEX cases_tenant_zone_registered_idx ON "cases" (tenant_id, zone_id, registered_at);

-- RLS shape from policy.ts
ALTER TABLE "cases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cases" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cases" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
