-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- agents; default_vehicle_id needs vehicles first
CREATE TABLE "agents" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  code text NOT NULL,
  name_en text NOT NULL,
  name_ar text,
  kind text NOT NULL,
  home_zone_id uuid,
  default_vehicle_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  extra jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT agents_tenant_code_key UNIQUE (tenant_id, code),
  CONSTRAINT agents_home_zone_id_fkey FOREIGN KEY (tenant_id, home_zone_id) REFERENCES "zones" (tenant_id, id),
  CONSTRAINT agents_default_vehicle_id_fkey FOREIGN KEY (tenant_id, default_vehicle_id) REFERENCES "vehicles" (tenant_id, id)
);

-- RLS shape from policy.ts
ALTER TABLE "agents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agents" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "agents" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
