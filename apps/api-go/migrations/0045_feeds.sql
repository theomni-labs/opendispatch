-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- inbound feeds: every signed request is stored first, then applied in order by the processor
CREATE TABLE "feed_events" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  feed text NOT NULL CHECK (feed IN ('case', 'agent_status')),
  idempotency_key text NOT NULL,
  key_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'applied', 'stale', 'rejected')),
  applied_at timestamptz,
  reject_reason text,
  PRIMARY KEY (tenant_id, id)
);

-- a re-sent event hits this key and is ignored
CREATE UNIQUE INDEX feed_events_tenant_idem_idx ON "feed_events" (tenant_id, feed, idempotency_key);
CREATE INDEX feed_events_tenant_queue_idx ON "feed_events" (tenant_id, status, occurred_at, seq);
CREATE INDEX feed_events_tenant_received_idx ON "feed_events" (tenant_id, feed, received_at);

-- RLS shape from policy.ts
ALTER TABLE "feed_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "feed_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "feed_events" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- agent status and position history; the newest row per agent is kept in agent_live_state
CREATE TABLE "agent_status_history" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL,
  status text NOT NULL,
  latitude double precision,
  longitude double precision,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT agent_status_history_agent_id_fkey FOREIGN KEY (tenant_id, agent_id) REFERENCES "agents" (tenant_id, id)
);

CREATE INDEX agent_status_history_tenant_agent_idx ON "agent_status_history" (tenant_id, agent_id, occurred_at);
CREATE INDEX agent_status_history_tenant_occurred_idx ON "agent_status_history" (tenant_id, occurred_at);

ALTER TABLE "agent_status_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_status_history" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "agent_status_history" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

CREATE TABLE "agent_live_state" (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL,
  status text NOT NULL,
  latitude double precision,
  longitude double precision,
  occurred_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT agent_live_state_agent_key UNIQUE (tenant_id, agent_id),
  CONSTRAINT agent_live_state_agent_id_fkey FOREIGN KEY (tenant_id, agent_id) REFERENCES "agents" (tenant_id, id)
);

ALTER TABLE "agent_live_state" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_live_state" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "agent_live_state" USING (tenant_id = current_setting('app.tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- a case arrives once per external id; later events update it
CREATE UNIQUE INDEX cases_tenant_external_id_idx ON "cases" (tenant_id, external_id) WHERE external_id IS NOT NULL;
