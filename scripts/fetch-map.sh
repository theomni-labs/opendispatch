#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Fetch the basemap: a small extract of the OpenStreetMap-based Protomaps planet build for the
# sample geography. Map data (c) OpenStreetMap contributors, ODbL 1.0; see THIRD_PARTY_NOTICES.md.
#   scripts/fetch-map.sh [output file]        needs the pmtiles CLI (go-pmtiles, BSD-3-Clause)
# Overrides: OPENDISPATCH_MAP_BUILD (for example 20251117.pmtiles), OPENDISPATCH_MAP_BBOX, OPENDISPATCH_MAP_MAXZOOM.
set -eu
OUT=${1:-apps/web/public/maps/saudi.pmtiles}
BBOX=${OPENDISPATCH_MAP_BBOX:-34.4,16.3,55.7,32.2}
MAXZOOM=${OPENDISPATCH_MAP_MAXZOOM:-11}
BUILD=${OPENDISPATCH_MAP_BUILD:-}
if [ -z "$BUILD" ]; then
  BUILD=$(curl -fsS --max-time 30 https://build-metadata.protomaps.dev/builds.json \
    | grep -o '"key":"[0-9]\{8\}\.pmtiles"' | tail -1 | cut -d'"' -f4)
fi
[ -n "$BUILD" ] || { echo "fetch-map: could not find a Protomaps build" >&2; exit 1; }
mkdir -p "$(dirname "$OUT")"
echo "fetch-map: extracting $BBOX up to zoom $MAXZOOM from $BUILD"
PMTILES=$(command -v pmtiles || command -v go-pmtiles) || { echo "fetch-map: install the pmtiles CLI (go install github.com/protomaps/go-pmtiles@latest)" >&2; exit 1; }
"$PMTILES" extract "https://build.protomaps.com/$BUILD" "$OUT" --bbox="$BBOX" --maxzoom="$MAXZOOM"
