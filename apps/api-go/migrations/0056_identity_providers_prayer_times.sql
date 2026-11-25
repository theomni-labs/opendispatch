-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- identity providers (no secrets, only a flag) and recomputed prayer times
CREATE TABLE "identity_providers" (
  tenant_id uuid NOT NULL,
  id text NOT NULL,
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  preset_id text NOT NULL,
  display_name text NOT NULL,
  protocol text NOT NULL,
  is_enabled boolean NOT NULL,
  email_domains jsonb NOT NULL DEFAULT '[]'::jsonb,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  claim_mapping jsonb NOT NULL,
  has_secret boolean NOT NULL DEFAULT false,
  signed_assertions_required boolean NOT NULL DEFAULT true,
  last_test_at timestamptz,
  last_test_ok boolean,
  PRIMARY KEY (tenant_id, id)
);

-- RLS shape from policy.ts
ALTER TABLE "identity_providers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identity_providers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "identity_providers" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE TABLE "prayer_times" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  city_id uuid NOT NULL,
  prayer_date date NOT NULL,
  fajr text NOT NULL,
  sunrise text NOT NULL,
  dhuhr text NOT NULL,
  asr text NOT NULL,
  maghrib text NOT NULL,
  isha text NOT NULL,
  calculation_method text NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT prayer_times_city_id_fkey FOREIGN KEY (tenant_id, city_id) REFERENCES "cities" (tenant_id, id)
);

CREATE UNIQUE INDEX prayer_times_tenant_city_date_idx ON "prayer_times" (tenant_id, city_id, prayer_date);

-- RLS shape from policy.ts
ALTER TABLE "prayer_times" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prayer_times" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "prayer_times" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
