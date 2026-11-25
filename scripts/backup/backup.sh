#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Back up; docs/deploy/BACKUP_RESTORE.md
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=scripts/backup/lib.sh
. "$HERE/lib.sh"

usage() {
  cat <<'EOF'
Usage: backup.sh --out DIR [--no-objects]

Environment:
  OPENDISPATCH_BACKUP_DATABASE_URL  OpenDispatch database, owner role (BYPASSRLS) or a
                             superuser; no password in it: use PGPASSWORD
                             or ~/.pgpass
  OPENDISPATCH_PG_IMAGE             optional: run pg_dump/psql from this image
                             (same Postgres major as the server)
  OPENDISPATCH_BACKUP_S3_URL        object storage, e.g. https://s3.example:9000
  OPENDISPATCH_BACKUP_S3_BUCKET     bucket to copy (default opendispatch-imports)
  OPENDISPATCH_BACKUP_S3_ACCESS_KEY / OPENDISPATCH_BACKUP_S3_SECRET_KEY
  OPENDISPATCH_RCLONE_IMAGE         optional: rclone image when rclone is not installed
EOF
}

OUT="" OBJECTS=1
while [ $# -gt 0 ]; do
  case $1 in
    --out) OUT=$2; shift 2 ;;
    --no-objects) OBJECTS=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown argument $1" ;;
  esac
done
[ -n "$OUT" ] || { usage >&2; die "--out is required"; }
URL=${OPENDISPATCH_BACKUP_DATABASE_URL:-}
[ -n "$URL" ] || die "OPENDISPATCH_BACKUP_DATABASE_URL is not set"
case $URL in *://*:*@*) die "put the password in PGPASSWORD or ~/.pgpass, not in the URL" ;; esac

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DIR=$(mkdir -p "$OUT" && cd "$OUT" && pwd)/opendispatch-backup-$STAMP
mkdir -p "$DIR"
PG_MOUNTS=("$DIR")
S3_MOUNTS=("$DIR")

log "reading server and TimescaleDB versions"
SERVER=$(psql_at "$URL" -c "SHOW server_version_num")
TSDB=$(psql_at "$URL" -c "SELECT coalesce((SELECT extversion FROM pg_extension WHERE extname='timescaledb'),'')")
MIGRATIONS=$(psql_at "$URL" -c "SELECT count(*) FROM opendispatch_meta.schema_migrations")
DBNAME=$(psql_at "$URL" -c "SELECT current_database()")
HYPER=0
[ -n "$TSDB" ] && HYPER=$(psql_at "$URL" -c "$HYPERTABLES_SQL")

log "counting rows before the dump"
row_counts "$URL" > "$DIR/row_counts.tsv"
forecast_check "$URL" > "$DIR/forecast_check.tsv"

# Timescale catalog FK warnings are expected
log "pg_dump (custom format) of $DBNAME"
pg_run pg_dump --format=custom --compress=6 --no-sync \
  --file="$DIR/opendispatch.dump" --dbname="$URL"
pg_run pg_restore --list "$DIR/opendispatch.dump" > "$DIR/opendispatch.dump.list"

OBJ_COUNT=0
if [ "$OBJECTS" = 1 ] && [ -n "${OPENDISPATCH_BACKUP_S3_URL:-}" ]; then
  : "${OPENDISPATCH_BACKUP_S3_ACCESS_KEY:?not set}" "${OPENDISPATCH_BACKUP_S3_SECRET_KEY:?not set}"
  BUCKET=${OPENDISPATCH_BACKUP_S3_BUCKET:-opendispatch-imports}
  s3_remote src "$OPENDISPATCH_BACKUP_S3_URL" "$OPENDISPATCH_BACKUP_S3_ACCESS_KEY" "$OPENDISPATCH_BACKUP_S3_SECRET_KEY"
  mkdir -p "$DIR/objects"
  log "copying bucket $BUCKET"
  s3_run copy --quiet "src:$BUCKET" "$DIR/objects" >/dev/null
  OBJ_COUNT=$(find "$DIR/objects" -type f | wc -l)
  log "$OBJ_COUNT objects copied"
elif [ "$OBJECTS" = 1 ]; then
  log "OPENDISPATCH_BACKUP_S3_URL not set: object storage skipped"
fi

cat > "$DIR/metadata.json" <<EOF
{
  "created_at": "$STAMP",
  "database": "$DBNAME",
  "server_version_num": $SERVER,
  "timescaledb_version": "$TSDB",
  "hypertables": "$HYPER",
  "migrations_applied": $MIGRATIONS,
  "objects": $OBJ_COUNT,
  "bucket": "${OPENDISPATCH_BACKUP_S3_BUCKET:-opendispatch-imports}"
}
EOF

log "writing checksums"
SUMS=$(mktemp)
(cd "$DIR" && find . -type f -print0 | sort -z | xargs -0 sha256sum) > "$SUMS"
mv "$SUMS" "$DIR/SHA256SUMS"
log "backup written to $DIR ($(du -sh "$DIR" | cut -f1))"
echo "$DIR"
