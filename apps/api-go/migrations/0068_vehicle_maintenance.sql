-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- vehicle maintenance windows
CREATE TABLE "vehicle_maintenance" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  vehicle_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text NOT NULL,
  extra jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT vehicle_maintenance_window_check CHECK (ends_at > starts_at),
  CONSTRAINT vehicle_maintenance_vehicle_id_fkey FOREIGN KEY (tenant_id, vehicle_id) REFERENCES "vehicles" (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX vehicle_maintenance_tenant_vehicle_starts_idx ON "vehicle_maintenance" (tenant_id, vehicle_id, starts_at);
CREATE INDEX vehicle_maintenance_tenant_ends_idx ON "vehicle_maintenance" (tenant_id, ends_at);

ALTER TABLE "vehicle_maintenance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vehicle_maintenance" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "vehicle_maintenance" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
