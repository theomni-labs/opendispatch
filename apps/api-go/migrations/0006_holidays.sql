-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- calendar holidays, Hijri dates stored alongside
CREATE TABLE "holidays" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  name_en text NOT NULL,
  name_ar text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  kind text NOT NULL,
  hijri_start jsonb,
  hijri_end jsonb,
  PRIMARY KEY (tenant_id, id)
);

-- RLS shape from policy.ts
ALTER TABLE "holidays" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "holidays" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "holidays" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
