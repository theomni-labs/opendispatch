#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Fails when a library dependency is under a copyleft or source-available licence that would
# restrict how OpenDispatch can be distributed: AGPL, GPL, LGPL, SSPL, BUSL, Elastic, Commons Clause.
# Services the stack only runs next to it (for example a database) are covered in THIRD_PARTY_NOTICES.md.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
DENY='AGPL|(^|[^L])GPL|LGPL|SSPL|BUSL|BSL-1|Elastic|Commons-Clause|UNLICENSED|UNKNOWN'
status=0

echo "== Node (pnpm licenses list -r --prod)"
node_out=$(pnpm licenses list -r --prod --json)
bad=$(printf '%s' "$node_out" | node -e '
  const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const deny = new RegExp(process.argv[1], "i");
  for (const [lic, pkgs] of Object.entries(d)) {
    if (!deny.test(lic)) continue;
    for (const p of pkgs) if (!String(p.name).startsWith("@opendispatch/")) console.log(`${p.name}@${p.versions ?? p.version}: ${lic}`);
  }' "$DENY")
if [ -n "$bad" ]; then echo "$bad"; status=1; else echo "ok"; fi

echo "== Go (go-licenses)"
go install github.com/google/go-licenses/v2@v2.0.1
(cd apps/api-go && go-licenses check ./... --disallowed_types=forbidden,restricted,unknown --ignore github.com/theomni-labs/opendispatch) || status=1

echo "== Python engines (pip-licenses)"
python -m venv /tmp/od-lic && . /tmp/od-lic/bin/activate
pip install -q -r engines/requirements/base.txt pip-licenses==5.0.0
pip-licenses --partial-match --fail-on='GNU General Public License;GNU Affero;GPL;SSPL;Business Source' || status=1
deactivate

exit "$status"
