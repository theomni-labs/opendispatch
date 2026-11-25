-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- saved mapping versions
CREATE TABLE "import_mappings" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  version text NOT NULL,
  base_version text NOT NULL,
  notes text,
  columns jsonb NOT NULL DEFAULT '[]',
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT import_mappings_data_source_check CHECK (data_source IN ('SYNTHETIC', 'IMPORTED', 'LIVE')),
  CONSTRAINT import_mappings_version_check CHECK (version ~ '^[a-z][a-z0-9_]{2,63}$')
);
CREATE UNIQUE INDEX import_mappings_tenant_version_idx ON "import_mappings" (tenant_id, version);

ALTER TABLE "import_mappings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_mappings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "import_mappings" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
