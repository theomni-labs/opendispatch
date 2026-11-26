#!/usr/bin/env bash
# Renders docs/diagrams/*.mmd to light and dark PNGs, so diagrams show everywhere (GitHub mobile does not draw Mermaid).
set -euo pipefail
cd "$(dirname "$0")/../docs/diagrams"
for f in *.mmd; do
  n=${f%.mmd}
  for m in light dark; do
    docker run --rm -u "$(id -u):$(id -g)" -v "$PWD:/data" minlag/mermaid-cli:11.4.2 \
      -i "/data/$f" -o "/data/$n-$m.png" -c "/data/cfg-$m.json" -b transparent -s 2 -w 1100 >/dev/null
  done
done
