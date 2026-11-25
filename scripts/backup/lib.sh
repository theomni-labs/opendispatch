#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Helpers for backup.sh and restore.sh
# shellcheck disable=SC2034

die() { echo "error: $*" >&2; exit 1; }
log() { echo "[$(date -u +%H:%M:%S)] $*" >&2; }

# psql/pg_dump: local, or from OPENDISPATCH_PG_IMAGE
pg_run() {
  if [ -n "${OPENDISPATCH_PG_IMAGE:-}" ]; then
    local mounts=()
    for d in "${PG_MOUNTS[@]:-}"; do
      [ -n "$d" ] && mounts+=(-v "$d:$d")
    done
    docker run --rm -i --network host --user "$(id -u):$(id -g)" \
      -e PGPASSWORD -e PGSSLMODE -e PGCONNECT_TIMEOUT "${mounts[@]}" \
      --entrypoint "$1" "$OPENDISPATCH_PG_IMAGE" "${@:2}"
  else
    command -v "$1" >/dev/null || die "$1 not found; install it or set OPENDISPATCH_PG_IMAGE"
    "$@"
  fi
}

# psql, one value per line, stop on error.
psql_at() {
  local url=$1; shift
  pg_run psql -X -v ON_ERROR_STOP=1 -q -At -d "$url" "$@"
}

# s3_remote NAME URL KEY SECRET: an rclone remote for any S3-compatible store, by environment only
s3_remote() {
  local name=${1^^}
  export "RCLONE_CONFIG_${name}_TYPE=s3" "RCLONE_CONFIG_${name}_PROVIDER=Other" \
    "RCLONE_CONFIG_${name}_ENDPOINT=$2" "RCLONE_CONFIG_${name}_ACCESS_KEY_ID=$3" \
    "RCLONE_CONFIG_${name}_SECRET_ACCESS_KEY=$4" "RCLONE_CONFIG_${name}_FORCE_PATH_STYLE=true"
}

# rclone (MIT): local, or from OPENDISPATCH_RCLONE_IMAGE
s3_run() {
  if command -v rclone >/dev/null && [ -z "${OPENDISPATCH_RCLONE_IMAGE:-}" ]; then
    rclone "$@"
  else
    local image=${OPENDISPATCH_RCLONE_IMAGE:-rclone/rclone:1.76.0}
    local envs=() mounts=()
    for v in $(compgen -e | grep '^RCLONE_CONFIG_' || true); do envs+=(-e "$v"); done
    for d in "${S3_MOUNTS[@]:-}"; do
      [ -n "$d" ] && mounts+=(-v "$d:$d")
    done
    docker run --rm --network host --user "$(id -u):$(id -g)" -e HOME=/tmp \
      "${envs[@]}" "${mounts[@]}" "$image" "$@"
  fi
}

# Row count of every OpenDispatch table
COUNT_TABLES_SQL="SELECT format('SELECT %L, count(*) FROM %I.%I', schemaname||'.'||tablename, schemaname, tablename)
  FROM pg_tables WHERE schemaname IN ('public','platform','opendispatch_meta') ORDER BY 1"

row_counts() {
  local url=$1 q
  q=$(psql_at "$url" -c "$COUNT_TABLES_SQL" | paste -sd'|' | sed 's/|/ UNION ALL /g')
  [ -n "$q" ] || die "no OpenDispatch tables found"
  psql_at "$url" -F $'\t' -c "SELECT * FROM ($q) t ORDER BY 1"
}

# Content check of forecast_values
FORECAST_CHECK_SQL="SELECT count(*), count(DISTINCT forecast_run_id),
  min(interval_start), max(interval_start),
  md5(coalesce(string_agg(tenant_id||'/'||id||'/'||interval_start||'/'||coalesce(expected::text,'')||'/'||coalesce(low::text,'')||'/'||coalesce(high::text,''), ',' ORDER BY tenant_id, id, interval_start), ''))
  FROM forecast_values"

forecast_check() {
  psql_at "$1" -F $'\t' -c "$FORECAST_CHECK_SQL"
}

# Hypertable names, space separated
HYPERTABLES_SQL="SELECT coalesce(string_agg(hypertable_schema||'.'||hypertable_name, ' ' ORDER BY 1), '') FROM timescaledb_information.hypertables"
