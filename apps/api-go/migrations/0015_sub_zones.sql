-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- sub-zones within a zone
CREATE TABLE "sub_zones" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  external_id text,
  zone_id uuid NOT NULL,
  name_en text NOT NULL,
  name_ar text,
  latitude double precision,
  longitude double precision,
  is_active boolean NOT NULL DEFAULT true,
  extra jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT sub_zones_zone_id_fkey FOREIGN KEY (tenant_id, zone_id) REFERENCES "zones" (tenant_id, id)
);

-- RLS shape from policy.ts
ALTER TABLE "sub_zones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sub_zones" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sub_zones" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
