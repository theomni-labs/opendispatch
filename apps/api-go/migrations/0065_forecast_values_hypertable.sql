-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false
-- contract: pkey gains interval_start

-- plain Postgres skips all of it
DO $$
BEGIN
  IF current_setting('opendispatch.timescaledb', true) = 'off' THEN
    RAISE NOTICE 'opendispatch.timescaledb=off: forecast_values stays plain';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb') THEN
    RAISE NOTICE 'timescaledb not installed: forecast_values stays plain';
    RETURN;
  END IF;
  -- unpreloaded CREATE EXTENSION is FATAL
  IF NOT EXISTS (SELECT 1 FROM pg_settings WHERE name = 'timescaledb.disable_load') THEN
    RAISE NOTICE 'timescaledb not preloaded: forecast_values stays plain';
    RETURN;
  END IF;
  BEGIN
    CREATE EXTENSION IF NOT EXISTS timescaledb;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'timescaledb unusable (%): forecast_values stays plain', SQLERRM;
    RETURN;
  END;

  -- chunks: no USAGE for anyone but the owner
  CREATE SCHEMA IF NOT EXISTS opendispatch_chunks;
  REVOKE ALL ON SCHEMA opendispatch_chunks FROM PUBLIC;

  ALTER TABLE "forecast_values" DROP CONSTRAINT forecast_values_pkey;
  ALTER TABLE "forecast_values" ADD CONSTRAINT forecast_values_pkey PRIMARY KEY (tenant_id, id, interval_start);

  PERFORM create_hypertable('forecast_values', 'interval_start',
    chunk_time_interval => INTERVAL '30 days',
    create_default_indexes => false,
    associated_schema_name => 'opendispatch_chunks',
    migrate_data => true);
END
$$;
