#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Offline bundle; docs/deploy/OFFLINE_BUNDLE.md
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
IMAGES=(api worker web engines)
VALUES=${OPENDISPATCH_BUNDLE_VALUES:-$ROOT/deploy/helm/opendispatch/values.yaml}

die() { echo "error: $*" >&2; exit 1; }
log() { echo "[$(date -u +%H:%M:%S)] $*" >&2; }

usage() {
  cat <<'EOF'
Usage: bundle.sh --out DIR [--tag TAG] [--build] [--engines-dir DIR]
                 [--sbom-dir DIR] [--gzip]
       bundle.sh --list-third-party

Takes opendispatch-{api,worker,web,engines}:TAG from the local Docker, or
builds them first with --build. OPENDISPATCH_BUNDLE_IMAGE_<NAME>=ref takes
that image as it is, never built (e.g. OPENDISPATCH_BUNDLE_IMAGE_WEB=...).
Adds every other image of the chart's values.yaml (images.*) at its
pinned tag and digest, pulled by digest if not in the local Docker.
--sbom-dir: a folder of <name>.sbom.spdx.json (the Images workflow's
artifacts); copied into the bundle when present.
EOF
}

# name repository tag digest, one line per third-party image
third_party() {
  [ -f "$VALUES" ] || die "no chart values at $VALUES"
  awk '
    function flush() { if (name != "") print name, (repo == "" ? "-" : repo), (tag == "" ? "-" : tag), (dig == "" ? "-" : dig); name = "" }
    function put(k, v) {
      gsub(/^[ \t"]+|[ \t"]+$/, "", k); gsub(/^[ \t"]+|[ \t"]+$/, "", v)
      if (k == "repository") repo = v; else if (k == "tag") tag = v; else if (k == "digest") dig = v
    }
    /^images:/ { on = 1; next }
    on && /^[^ #]/ { flush(); on = 0 }
    !on || /^[ ]*#/ || /^[ ]*$/ { next }
    /^  [A-Za-z0-9_-]+:/ {
      flush(); name = $1; sub(/:$/, "", name); repo = tag = dig = ""
      rest = $0; sub(/^  [A-Za-z0-9_-]+:[ ]*/, "", rest)
      if (rest ~ /^\{/) {
        gsub(/[{}]/, "", rest); n = split(rest, kv, ",")
        for (i = 1; i <= n; i++) { j = index(kv[i], ":"); put(substr(kv[i], 1, j - 1), substr(kv[i], j + 1)) }
      }
      next
    }
    /^    [a-z]+:/ { j = index($0, ":"); put(substr($0, 1, j - 1), substr($0, j + 1)) }
    END { flush() }
  ' "$VALUES" | while read -r name repo tag dig; do
    case " ${IMAGES[*]} " in *" $name "*) continue ;; esac
    [ "$repo" != - ] && [ "$tag" != - ] && [[ $dig =~ ^sha256:[0-9a-f]{64}$ ]] \
      || die "images.$name in $VALUES needs repository, tag and digest"
    echo "$name $repo $tag $dig"
  done
}

# "<digest> <name>" of the image in a saved tar
saved_index() {
  local f=$1 idx dig name
  if [[ $f == *.gz ]]; then idx=$(gzip -dc "$f" | tar -xO index.json 2>/dev/null || true)
  else idx=$(tar -xOf "$f" index.json 2>/dev/null || true); fi
  dig=$(grep -oE '"digest": ?"sha256:[0-9a-f]{64}"' <<<"$idx" | head -n1 | grep -oE 'sha256:[0-9a-f]{64}' || true)
  name=$(grep -oE '"io\.containerd\.image\.name": ?"[^"]+"' <<<"$idx" | head -n1 | sed -E 's/.*: ?"([^"]+)"/\1/' || true)
  echo "${dig:--} ${name:--}"
}

OUT="" TAG="" BUILD=0 ENGINES_DIR="$ROOT/engines" SBOM_DIR="" GZIP=0
while [ $# -gt 0 ]; do
  case $1 in
    --list-third-party) third_party; exit 0 ;;
    --out) OUT=$2; shift 2 ;;
    --tag) TAG=$2; shift 2 ;;
    --build) BUILD=1; shift ;;
    --engines-dir) ENGINES_DIR=$2; shift 2 ;;
    --sbom-dir) SBOM_DIR=$2; shift 2 ;;
    --gzip) GZIP=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown argument $1" ;;
  esac
done
[ -n "$OUT" ] || { usage >&2; die "--out is required"; }
TAG=${TAG:-$(git -C "$ROOT" rev-parse --short HEAD)}
[[ $TAG =~ ^[A-Za-z0-9_.-]+$ ]] || die "bad tag $TAG"
command -v docker >/dev/null || die "docker not found"
THIRD=$(third_party)

ref_for() {
  local var="OPENDISPATCH_BUNDLE_IMAGE_${1^^}"
  echo "${!var:-opendispatch-$1:$TAG}"
}

build() {
  local name=$1 ref=$2
  case $name in
    api|worker) docker build -q -f "$ROOT/apps/api-go/Dockerfile" --target "$name" -t "$ref" "$ROOT" ;;
    web) docker build -q -f "$ROOT/apps/web/Dockerfile" --target web -t "$ref" "$ROOT" ;;
    # lean target: no research libraries
    engines)
      [ -f "$ENGINES_DIR/Dockerfile" ] || die "no engines Dockerfile in $ENGINES_DIR (git submodule update --init engines)"
      docker build -q -f "$ENGINES_DIR/Dockerfile" --target engine -t "$ref" "$ENGINES_DIR" ;;
  esac >/dev/null
}

mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
[ -z "$(ls -A "$OUT")" ] || die "$OUT is not empty"
mkdir -p "$OUT/images" "$OUT/sbom"

entries=()
# name ref repository pinned-digest (- for ours)
add() {
  local name=$1 ref=$2 repo=$3 pin=$4
  docker image inspect "$ref" >/dev/null 2>&1 || die "image $ref not found (use --build)"
  id=$(docker image inspect --format '{{.Id}}' "$ref")
  user=$(docker image inspect --format '{{.Config.User}}' "$ref")
  case $user in ""|root|0|0:*) die "$ref runs as root; OpenDispatch images must be non-root" ;; esac
  file="images/$name.tar"
  log "saving $ref"
  if [ "$GZIP" = 1 ]; then
    file="$file.gz"
    docker save "$ref" | gzip -6 > "$OUT/$file"
  else
    docker save -o "$OUT/$file" "$ref"
  fi
  read -r dig iname < <(saved_index "$OUT/$file")
  if [ "$pin" != - ] && [ "$dig" != "$pin" ]; then
    die "$ref saved as $dig, not the chart's $pin (Docker must use the containerd image store)"
  fi
  size=$(stat -c %s "$OUT/$file")
  sbom=null
  if [ -n "$SBOM_DIR" ] && [ -f "$SBOM_DIR/$name.sbom.spdx.json" ]; then
    cp "$SBOM_DIR/$name.sbom.spdx.json" "$OUT/sbom/"
    sbom="\"sbom/$name.sbom.spdx.json\""
  fi
  local d=null n=null
  [ "$dig" != - ] && d="\"$dig\""
  [ "$iname" != - ] && n="\"$iname\""
  entries+=("    {\"name\": \"$name\", \"ref\": \"$ref\", \"repository\": \"$repo\", \"image_name\": $n, \"digest\": $d, \"image_id\": \"$id\", \"user\": \"$user\", \"file\": \"$file\", \"bytes\": $size, \"sbom\": $sbom}")
  log "$name: $(du -h "$OUT/$file" | cut -f1)"
}

for name in "${IMAGES[@]}"; do
  ref=$(ref_for "$name")
  over="OPENDISPATCH_BUNDLE_IMAGE_${name^^}"
  if [ "$BUILD" = 1 ] && [ -z "${!over:-}" ]; then
    log "building $name as $ref"
    build "$name" "$ref"
  fi
  add "$name" "$ref" "opendispatch-$name" -
done

while read -r name repo tag pin; do
  [ -n "$name" ] || continue
  ref="$repo:$tag"
  if ! docker image inspect "$ref" >/dev/null 2>&1; then
    log "pulling $repo@$pin"
    docker pull -q "$repo@$pin" >/dev/null
    docker tag "$repo@$pin" "$ref"
  fi
  add "$name" "$ref" "$repo" "$pin"
done <<<"$THIRD"

rmdir "$OUT/sbom" 2>/dev/null || true
chmod -R a+rX "$OUT"

{
  echo "{"
  echo "  \"bundle\": \"opendispatch\","
  echo "  \"tag\": \"$TAG\","
  echo "  \"commit\": \"$(git -C "$ROOT" rev-parse HEAD)\","
  echo "  \"created_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"images\": ["
  ( IFS=$'\n'; echo "${entries[*]}" ) | sed '$!s/$/,/'
  echo "  ]"
  echo "}"
} > "$OUT/manifest.json"
cp "$(dirname "$0")/load.sh" "$OUT/load.sh"

SUMS=$(mktemp)
(cd "$OUT" && find . -type f -print0 | sort -z | xargs -0 sha256sum) > "$SUMS"
mv "$SUMS" "$OUT/SHA256SUMS"
chmod a+r "$OUT/SHA256SUMS"
log "bundle written to $OUT ($(du -sh "$OUT" | cut -f1))"
