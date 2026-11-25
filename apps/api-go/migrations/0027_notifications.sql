-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- in-app notifications to a user or role
CREATE TABLE "notifications" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  recipient_user_id uuid,
  recipient_role text,
  category text NOT NULL,
  severity text NOT NULL,
  title_en text NOT NULL,
  title_ar text,
  body_en text NOT NULL,
  link_path text,
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT notifications_recipient_user_id_fkey FOREIGN KEY (tenant_id, recipient_user_id) REFERENCES "users" (tenant_id, id)
);

-- RLS shape from policy.ts
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notifications" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
