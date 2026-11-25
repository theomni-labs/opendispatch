-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- where a roster's lines came from, and why a fallback was used
ALTER TABLE "rosters"
  ADD COLUMN optimizer_source text CONSTRAINT rosters_optimizer_source_check CHECK (optimizer_source IN ('optimizer', 'fallback')),
  ADD COLUMN fallback_reason text CONSTRAINT rosters_fallback_reason_check CHECK (fallback_reason IN ('no_forecast_for_day', 'engine_unavailable', 'no_answer'));
