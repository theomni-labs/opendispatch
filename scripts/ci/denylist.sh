#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Fails when a word from the project's deny list appears in a tracked file's content or path,
# in any letter case. The words are stored base64-encoded so this file does not trip itself.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

WORDS_B64=(
  bmFqbQ== YWRwc3M= bnVkZ2V1bQ== 2YbYrNmF dW5uYWpt bW9yb29y bGVnaW9u aWJyYWhpbQ== dmlwdXI= YXJ1bg==
  Y2FjaGV0 cnVwaXY= Y2xhdWRl YW50aHJvcGlj Y28tYXV0aG9yZWQ= b21uaWFwcHM=
)

pattern=""
for w in "${WORDS_B64[@]}"; do
  word=$(printf '%s' "$w" | base64 -d)
  pattern="${pattern:+$pattern|}$word"
done

status=0
if git grep -I -n -i -E -e "$pattern" -- . ':!*.pmtiles'; then
  echo "denylist: the words above must not appear in the repository" >&2
  status=1
fi
if git ls-files | grep -i -E -e "$pattern"; then
  echo "denylist: the paths above must not appear in the repository" >&2
  status=1
fi
if git ls-files -s | awk '$1 == "120000" { print $4 }' | while read -r link; do readlink "$link"; done | grep -i -E -e "$pattern"; then
  echo "denylist: the symbolic link targets above must not appear in the repository" >&2
  status=1
fi
if git log --format='%an%n%ae%n%cn%n%ce%n%B' | grep -i -E -e "$pattern" >/dev/null; then
  echo "denylist: a commit message or identity contains a denied word" >&2
  status=1
fi
[ "$status" = 0 ] && echo "denylist: clean"
exit "$status"
