-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- zones within a city
CREATE TABLE "zones" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  external_id text,
  city_id uuid NOT NULL,
  name_en text NOT NULL,
  name_ar text,
  latitude double precision,
  longitude double precision,
  is_active boolean NOT NULL DEFAULT true,
  extra jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT zones_city_id_fkey FOREIGN KEY (tenant_id, city_id) REFERENCES "cities" (tenant_id, id)
);

-- RLS shape from policy.ts
ALTER TABLE "zones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "zones" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "zones" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
