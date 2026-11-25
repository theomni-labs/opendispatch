#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-only
# Shared realm: organisations. Idempotent.
set -euo pipefail
: "${KC_SERVER:?}" "${KC_ADMIN_USER:?}" "${KC_ADMIN_PASSWORD:?}" "${REALM:?}" "${CLIENT_ID:?}" "${ORGANIZATIONS:?}"
kc() { /opt/keycloak/bin/kcadm.sh "$@" --config /tmp/kcadm-orgs.config; }
# first column of the csv row whose second is $1
pick() { while IFS=, read -r a b; do if [ "$b" = "$1" ]; then echo "$a"; return; fi; done; }
trap 'rm -f /tmp/kcadm-orgs.config' EXIT
ok=0
for _ in $(seq 1 60); do
  if KC_CLI_PASSWORD="$KC_ADMIN_PASSWORD" kc config credentials --server "$KC_SERVER" \
       --realm master --user "$KC_ADMIN_USER" >/dev/null 2>&1; then ok=1; break; fi
  sleep 5
done
[ "$ok" = 1 ] || { echo "shared-realm: Keycloak did not accept the sign-in"; exit 1; }
kc get "realms/$REALM" >/dev/null 2>&1 || { echo "shared-realm: realm $REALM missing"; exit 1; }
kc update "realms/$REALM" -s organizationsEnabled=true >/dev/null
echo "shared-realm: organisations on in $REALM"
cid="$(kc get clients -r "$REALM" -q "clientId=$CLIENT_ID" --fields id --format csv --noquotes)"
[ -n "$cid" ] || { echo "shared-realm: client $CLIENT_ID missing"; exit 1; }
sid="$(kc get client-scopes -r "$REALM" --fields id,name --format csv --noquotes | pick organization)"
[ -n "$sid" ] || { echo "shared-realm: client scope organization missing"; exit 1; }
if ! kc get "clients/$cid/default-client-scopes" -r "$REALM" --fields name --format csv --noquotes | grep -qx organization; then
  kc update "clients/$cid/optional-client-scopes/$sid" -r "$REALM" >/dev/null
fi
echo "shared-realm: scope organization on $CLIENT_ID"
mid="$(kc get "client-scopes/$sid/protocol-mappers/models" -r "$REALM" --fields id,protocolMapper --format csv --noquotes | pick oidc-organization-membership-mapper)"
[ -n "$mid" ] || { echo "shared-realm: organization claim mapper missing"; exit 1; }
kc update "client-scopes/$sid/protocol-mappers/models/$mid" -r "$REALM" \
  -s 'config."id.token.claim"=true' -s 'config."access.token.claim"=true' -s 'config."claim.name"=organization' \
  -s 'config.addOrganizationId=true' >/dev/null
echo "shared-realm: claim organization in ID and access tokens, with ids"
for alias in $ORGANIZATIONS; do
  [[ "$alias" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]] || { echo "shared-realm: bad alias $alias"; exit 1; }
  find() { kc get organizations -r "$REALM" -q "search=$alias" -q exact=true --fields id,alias --format csv --noquotes | pick "$alias"; }
  oid="$(find)"
  if [ -z "$oid" ]; then
    printf '{"name":"%s","alias":"%s","enabled":true}' "$alias" "$alias" | kc create organizations -r "$REALM" -f - >/dev/null
    oid="$(find)"
    echo "shared-realm: organisation $alias created, id $oid"
  else
    echo "shared-realm: organisation $alias exists, id $oid"
  fi
done
echo "shared-realm: done; members are added by us, never by this job"
