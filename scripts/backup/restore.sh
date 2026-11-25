#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Restore and verify; docs/deploy/BACKUP_RESTORE.md
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=scripts/backup/lib.sh
. "$HERE/lib.sh"

usage() {
  cat <<'EOF'
Usage: restore.sh --from BACKUP_DIR --db NAME [--owner ROLE]
                  [--drop-existing] [--no-objects] [--verify-only]

Environment:
  OPENDISPATCH_RESTORE_ADMIN_URL  a maintenance database (e.g. .../postgres) as a
                           role that may create the database and run
                           timescaledb_pre_restore (superuser on most
                           installs); no password in it: use PGPASSWORD
  OPENDISPATCH_PG_IMAGE           optional: run psql/pg_restore from this image
  OPENDISPATCH_RESTORE_S3_URL / OPENDISPATCH_RESTORE_S3_BUCKET /
  OPENDISPATCH_RESTORE_S3_ACCESS_KEY / OPENDISPATCH_RESTORE_S3_SECRET_KEY
  OPENDISPATCH_RCLONE_IMAGE       optional: rclone image when rclone is not installed
EOF
}

FROM="" DB="" OWNER=opendispatch_owner DROP=0 OBJECTS=1 VERIFY_ONLY=0
while [ $# -gt 0 ]; do
  case $1 in
    --from) FROM=$2; shift 2 ;;
    --db) DB=$2; shift 2 ;;
    --owner) OWNER=$2; shift 2 ;;
    --drop-existing) DROP=1; shift ;;
    --no-objects) OBJECTS=0; shift ;;
    --verify-only) VERIFY_ONLY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown argument $1" ;;
  esac
done
[ -n "$FROM" ] && [ -n "$DB" ] || { usage >&2; die "--from and --db are required"; }
[[ $DB =~ ^[a-z_][a-z0-9_]*$ ]] || die "database name must be lower case letters, digits and _"
[[ $OWNER =~ ^[a-z_][a-z0-9_]*$ ]] || die "bad owner role name"
ADMIN=${OPENDISPATCH_RESTORE_ADMIN_URL:-}
[ -n "$ADMIN" ] || die "OPENDISPATCH_RESTORE_ADMIN_URL is not set"
case $ADMIN in *://*:*@*) die "put the password in PGPASSWORD or ~/.pgpass, not in the URL" ;; esac
FROM=$(cd "$FROM" && pwd)
PG_MOUNTS=("$FROM")
S3_MOUNTS=("$FROM")
# Same server, the restored database
TARGET=$(printf '%s' "$ADMIN" | sed -E "s#^([^?]*/)[^/?]*#\1$DB#")

log "verifying checksums"
(cd "$FROM" && sha256sum --check --quiet --strict SHA256SUMS) \
  || die "checksum mismatch in $FROM: refusing to restore"

meta() { sed -nE "s/^ *\"$1\": *\"?([^\",]*)\"?,?$/\1/p" "$FROM/metadata.json"; }
TSDB=$(meta timescaledb_version)

verify() {
  local fail=0
  row_counts "$TARGET" > "$FROM/.restored_counts.tsv"
  forecast_check "$TARGET" > "$FROM/.restored_forecast.tsv"
  if diff -u "$FROM/row_counts.tsv" "$FROM/.restored_counts.tsv" >&2; then
    log "row counts match: $(wc -l < "$FROM/row_counts.tsv") tables, $(awk -F'\t' '{s+=$2} END {print s}' "$FROM/row_counts.tsv") rows"
  else
    log "ROW COUNTS DIFFER"; fail=1
  fi
  if diff -u "$FROM/forecast_check.tsv" "$FROM/.restored_forecast.tsv" >&2; then
    log "forecast_values check matches: $(cut -f1,2 "$FROM/forecast_check.tsv" | tr '\t' ' ') (rows, runs)"
  else
    log "FORECAST_VALUES CHECK DIFFERS"; fail=1
  fi
  if [ -n "$TSDB" ]; then
    local hyper
    hyper=$(psql_at "$TARGET" -c "$HYPERTABLES_SQL")
    if [ "$hyper" = "$(meta hypertables)" ]; then
      log "hypertables restored as hypertables: $hyper"
    else
      log "HYPERTABLES DIFFER: backup '$(meta hypertables)', restored '$hyper'"; fail=1
    fi
  fi
  rm -f "$FROM/.restored_counts.tsv" "$FROM/.restored_forecast.tsv"
  return $fail
}

if [ "$VERIFY_ONLY" = 1 ]; then verify; exit; fi

if [ -n "$TSDB" ]; then
  have=$(psql_at "$ADMIN" -c "SELECT count(*) FROM pg_available_extension_versions WHERE name='timescaledb' AND version='$TSDB'")
  [ "$have" = 1 ] || die "TimescaleDB $TSDB is not available on the target server: install that version first"
fi

exists=$(psql_at "$ADMIN" -c "SELECT count(*) FROM pg_database WHERE datname='$DB'")
if [ "$exists" = 1 ]; then
  [ "$DROP" = 1 ] || die "database $DB exists; pass --drop-existing to replace it"
  log "dropping existing database $DB"
  psql_at "$ADMIN" -c "DROP DATABASE \"$DB\" WITH (FORCE)"
fi

log "creating database $DB owned by $OWNER"
psql_at "$ADMIN" -c "CREATE DATABASE \"$DB\" OWNER \"$OWNER\""

if [ -n "$TSDB" ]; then
  # Timescale: extension first, then pre_restore.
  log "TimescaleDB $TSDB: pre_restore"
  psql_at "$TARGET" -c "CREATE EXTENSION IF NOT EXISTS timescaledb VERSION '$TSDB'" -c "SELECT timescaledb_pre_restore()" >/dev/null
fi

log "pg_restore"
pg_run pg_restore --exit-on-error --dbname="$TARGET" "$FROM/opendispatch.dump"

if [ -n "$TSDB" ]; then
  log "TimescaleDB: post_restore"
  psql_at "$TARGET" -c "SELECT timescaledb_post_restore()" >/dev/null
fi
psql_at "$TARGET" -c "ANALYZE"

if [ "$OBJECTS" = 1 ] && [ -d "$FROM/objects" ] && [ -n "${OPENDISPATCH_RESTORE_S3_URL:-}" ]; then
  : "${OPENDISPATCH_RESTORE_S3_ACCESS_KEY:?not set}" "${OPENDISPATCH_RESTORE_S3_SECRET_KEY:?not set}"
  BUCKET=${OPENDISPATCH_RESTORE_S3_BUCKET:-$(meta bucket)}
  s3_remote dst "$OPENDISPATCH_RESTORE_S3_URL" "$OPENDISPATCH_RESTORE_S3_ACCESS_KEY" "$OPENDISPATCH_RESTORE_S3_SECRET_KEY"
  log "restoring objects into bucket $BUCKET"
  s3_run mkdir "dst:$BUCKET" >/dev/null
  s3_run copy --quiet "$FROM/objects" "dst:$BUCKET" >/dev/null
  want=$(meta objects)
  got=$(s3_run lsf --recursive --files-only "dst:$BUCKET" | wc -l)
  [ "$got" -ge "$want" ] || die "bucket $BUCKET holds $got objects, backup had $want"
  log "objects restored: $got (backup had $want)"
elif [ "$OBJECTS" = 1 ] && [ -d "$FROM/objects" ]; then
  log "OPENDISPATCH_RESTORE_S3_URL not set: objects not restored"
fi

log "verifying"
verify
log "restore of $DB complete"
