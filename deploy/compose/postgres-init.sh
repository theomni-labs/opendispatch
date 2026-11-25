#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Runs once, on an empty data volume: the application role, which never bypasses row-level security.
set -eu
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<SQL
CREATE ROLE opendispatch_app LOGIN PASSWORD '${OPENDISPATCH_APP_DB_PASSWORD}' NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO opendispatch_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO opendispatch_app;
SQL
