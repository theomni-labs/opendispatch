#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# The demo's one-shot steps, on SYNTHETIC data only. Each step is a compose service:
#   seed      wait for the api (it migrates on start), then load the fixtures
#   feeds     the feeds simulator: the synthetic day shifted to end now, then new cases at the day's pace
#   history   vehicles and positions, the sample rule, and weeks of synthetic history
#   backfill  past forecasts, each made as of its own day, for the accuracy screens
set -eu
log() { echo "demo-setup: $*"; }
die() { echo "demo-setup: $*" >&2; exit 1; }

wait_http() { # URL
  i=0
  until node -e "fetch(process.argv[1]).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" "$1"; do
    i=$((i + 1)); [ "$i" -lt 300 ] || die "$1 did not answer"
    sleep 2
  done
}

tenant() { node -e "console.log(JSON.parse(require('fs').readFileSync('/repo/fixtures/manifest.json','utf8')).tenant_id)"; }

case "${1:-}" in
  seed)
    log "waiting for the api to finish its migrations"
    wait_http "$OPENDISPATCH_API_URL/ready"
    if [ "$(psql "$OPENDISPATCH_MIGRATION_DATABASE_URL" -Atc "select count(*) from cases" 2>/dev/null || echo 0)" != "0" ]; then
      log "the database already holds cases: seed skipped (docker compose down -v starts from scratch)"
      exit 0
    fi
    log "loading the synthetic fixtures"
    tsx scripts/db/seed-postgres-from-fixtures.ts --reset | tail -3
    ;;
  feeds)
    wait_http "$OPENDISPATCH_API_URL/ready"
    log "feeds simulator at ${OPENDISPATCH_DEMO_FEED_SPEED:-1}x"
    exec feedsim -url "$OPENDISPATCH_API_URL" -fixtures /repo/fixtures -to-now -follow -rules \
      -speed "${OPENDISPATCH_DEMO_FEED_SPEED:-1}" -board
    ;;
  history)
    if [ -f /state/history.done ]; then
      log "history already loaded: skipped"
      exit 0
    fi
    log "waiting for the feeds simulator's replay to be processed"
    i=0
    while :; do
      n="$(psql "$OPENDISPATCH_MIGRATION_DATABASE_URL" -Atc "select count(*) from feed_events" 2>/dev/null || echo 0)"
      q="$(psql "$OPENDISPATCH_MIGRATION_DATABASE_URL" -Atc "select count(*) from feed_events where status='queued'" 2>/dev/null || echo 1)"
      [ "$n" -gt 0 ] && [ "$q" = 0 ] && break
      i=$((i + 1)); [ "$i" -lt 600 ] || die "feed events were not processed"
      sleep 2
    done
    log "vehicles and positions at now"
    OPENDISPATCH_DEMO=1 tsx scripts/demo/seed-demo.ts
    log "sample classification rule and waiting spots"
    OPENDISPATCH_DEMO=1 OPENDISPATCH_TENANT_ID="$(tenant)" demoseed
    log "${OPENDISPATCH_DEMO_HISTORY_WEEKS:-52} weeks of synthetic history"
    OPENDISPATCH_DEMO=1 demohistory -weeks "${OPENDISPATCH_DEMO_HISTORY_WEEKS:-52}"
    touch /state/history.done
    ;;
  backfill)
    days="${OPENDISPATCH_DEMO_PAST_FORECAST_DAYS:-14}"
    [ "$days" = 0 ] && { log "past forecasts: off"; exit 0; }
    [ -f /state/backfill.done ] && { log "past forecasts already made: skipped"; exit 0; }
    log "$days past forecasts, each as of its own day"
    OPENDISPATCH_DEMO=1 OPENDISPATCH_TENANT_ID="$(tenant)" demoforecasts -days "$days"
    touch /state/backfill.done
    ;;
  *) die "usage: demo-setup seed|feeds|history|backfill" ;;
esac
