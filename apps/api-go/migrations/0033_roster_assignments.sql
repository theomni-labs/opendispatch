-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- one real table; fixtures split it per day
CREATE TABLE "roster_assignments" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  roster_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  shift_pattern_id uuid,
  zone_id uuid,
  roster_date date NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  vehicle_id uuid,
  break_start_at timestamptz,
  break_end_at timestamptz,
  standby_point_id uuid,
  is_override boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT roster_assignments_roster_id_fkey FOREIGN KEY (tenant_id, roster_id) REFERENCES "rosters" (tenant_id, id),
  CONSTRAINT roster_assignments_agent_id_fkey FOREIGN KEY (tenant_id, agent_id) REFERENCES "agents" (tenant_id, id),
  CONSTRAINT roster_assignments_shift_pattern_id_fkey FOREIGN KEY (tenant_id, shift_pattern_id) REFERENCES "shift_patterns" (tenant_id, id),
  CONSTRAINT roster_assignments_zone_id_fkey FOREIGN KEY (tenant_id, zone_id) REFERENCES "zones" (tenant_id, id),
  CONSTRAINT roster_assignments_vehicle_id_fkey FOREIGN KEY (tenant_id, vehicle_id) REFERENCES "vehicles" (tenant_id, id),
  CONSTRAINT roster_assignments_standby_point_id_fkey FOREIGN KEY (tenant_id, standby_point_id) REFERENCES "standby_points" (tenant_id, id)
);

-- RLS shape from policy.ts
ALTER TABLE "roster_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roster_assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "roster_assignments" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
