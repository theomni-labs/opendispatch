#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Verify the bundle, then import its images
set -euo pipefail

die() { echo "error: $*" >&2; exit 1; }
log() { echo "[$(date -u +%H:%M:%S)] $*" >&2; }

usage() {
  cat <<'EOF'
Usage: load.sh [--bundle DIR] [--runtime auto|k3s|docker]
               [--registry HOST/PROJECT] [--verify-only]

Checks every file against SHA256SUMS and refuses on any mismatch,
then imports the images: into k3s's containerd (k3s ctr images
import, plus a name@digest reference so a chart pinned by digest
finds the image), or into Docker (docker load). --registry (docker
runtime) also tags and pushes each image into the customer's own
registry, under <registry>/<repository>.
EOF
}

BUNDLE=$(cd "$(dirname "$0")" && pwd) RUNTIME=auto REGISTRY="" VERIFY_ONLY=0
while [ $# -gt 0 ]; do
  case $1 in
    --bundle) BUNDLE=$(cd "$2" && pwd); shift 2 ;;
    --runtime) RUNTIME=$2; shift 2 ;;
    --registry) REGISTRY=${2%/}; shift 2 ;;
    --verify-only) VERIFY_ONLY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown argument $1" ;;
  esac
done
[ -f "$BUNDLE/SHA256SUMS" ] || die "no SHA256SUMS in $BUNDLE"
[ -f "$BUNDLE/manifest.json" ] || die "no manifest.json in $BUNDLE"

log "verifying checksums"
(cd "$BUNDLE" && sha256sum --check --quiet --strict SHA256SUMS) \
  || die "checksum mismatch in $BUNDLE: refusing to import anything"

# one manifest line per image; "-" when a field is absent
field() {
  local v
  v=$(sed -nE "s/.*\"$1\": \"([^\"]+)\".*/\\1/p" <<<"$2")
  echo "${v:--}"
}
FILES=() REFS=() REPOS=() NAMES=() DIGESTS=()
while IFS= read -r line; do
  FILES+=("$(field file "$line")")
  REFS+=("$(field ref "$line")")
  REPOS+=("$(field repository "$line")")
  NAMES+=("$(field image_name "$line")")
  DIGESTS+=("$(field digest "$line")")
done < <(grep '"file": ' "$BUNDLE/manifest.json")
[ "${#FILES[@]}" -gt 0 ] || die "manifest lists no images"
# every image the manifest names must be listed
for f in "${FILES[@]}"; do
  grep -q "  ./$f\$" "$BUNDLE/SHA256SUMS" || die "$f is not covered by SHA256SUMS"
done
log "checksums OK: ${#FILES[@]} images"
[ "$VERIFY_ONLY" = 1 ] && exit 0

if [ "$RUNTIME" = auto ]; then
  if command -v k3s >/dev/null && k3s ctr version >/dev/null 2>&1; then RUNTIME=k3s
  elif command -v docker >/dev/null; then RUNTIME=docker
  else die "neither k3s nor docker found"; fi
fi

# the CRI finds repo@digest only under that name
k3s_digest_ref() {
  local name=$1 dig=$2 got
  got=$(k3s ctr images ls "name==$name" | awk 'NR == 2 { print $3 }')
  [ "$got" = "$dig" ] || die "$name imported as ${got:-nothing}, not $dig"
  k3s ctr images tag --force "$name" "${name%:*}@$dig" >/dev/null
  log "referenced ${name%:*}@$dig"
}

for i in "${!FILES[@]}"; do
  f="$BUNDLE/${FILES[$i]}"
  log "importing ${REFS[$i]} ($RUNTIME)"
  case $RUNTIME in
    k3s)
      if [[ $f == *.gz ]]; then gzip -dc "$f" | k3s ctr images import -
      else k3s ctr images import "$f"; fi
      if [ "${NAMES[$i]}" != - ] && [ "${DIGESTS[$i]}" != - ]; then
        k3s_digest_ref "${NAMES[$i]}" "${DIGESTS[$i]}"
      fi ;;
    docker) docker load -q -i "$f" ;;
    *) die "unknown runtime $RUNTIME" ;;
  esac
  if [ -n "$REGISTRY" ]; then
    [ "$RUNTIME" = docker ] || die "--registry needs --runtime docker"
    repo=${REPOS[$i]}
    # as the chart writes it: imageRegistry/repository
    if [ "$repo" = - ]; then repo=${REFS[$i]%:*}; repo=${repo##*/}; fi
    target="$REGISTRY/$repo:${REFS[$i]##*:}"
    docker tag "${REFS[$i]}" "$target"
    out=$(docker push "$target")
    pushed=$(grep -oE 'digest: sha256:[0-9a-f]{64}' <<<"$out" | tail -n1 | cut -d' ' -f2 || true)
    if [ "${DIGESTS[$i]}" != - ] && [ "$pushed" != "${DIGESTS[$i]}" ]; then
      log "warning: $target has digest ${pushed:-unknown}, not ${DIGESTS[$i]}; pin it by tag or by that digest"
    fi
    log "pushed $target"
  fi
done
log "imported ${#FILES[@]} images"
