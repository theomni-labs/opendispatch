-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- fixed standby locations for agents
CREATE TABLE "standby_points" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  zone_id uuid NOT NULL,
  sub_zone_id uuid,
  name_en text NOT NULL,
  name_ar text,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  coverage_radius_m int NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  extra jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT standby_points_zone_id_fkey FOREIGN KEY (tenant_id, zone_id) REFERENCES "zones" (tenant_id, id),
  CONSTRAINT standby_points_sub_zone_id_fkey FOREIGN KEY (tenant_id, sub_zone_id) REFERENCES "sub_zones" (tenant_id, id)
);

-- RLS shape from policy.ts
ALTER TABLE "standby_points" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "standby_points" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "standby_points" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
