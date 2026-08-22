#!/usr/bin/env bash
set -euo pipefail

: "${NETLIFY_AUTH_TOKEN:?NETLIFY_AUTH_TOKEN is required}"
: "${NETLIFY_SITE_ID:?NETLIFY_SITE_ID is required}"
: "${NETLIFY_CUSTOM_DOMAIN:?NETLIFY_CUSTOM_DOMAIN is required}"
: "${NETLIFY_LEGACY_DOMAIN:?NETLIFY_LEGACY_DOMAIN is required}"

api="https://api.netlify.com/api/v1/sites/${NETLIFY_SITE_ID}"
auth="Authorization: Bearer ${NETLIFY_AUTH_TOKEN}"
site="$(curl --fail --silent --show-error -H "$auth" "$api")"

aliases="$(
  jq -c --arg domain "$NETLIFY_CUSTOM_DOMAIN" --arg legacy "$NETLIFY_LEGACY_DOMAIN" '
    [(.domain_aliases // [])[] | select(. != $domain and . != $legacy)]
    + [$legacy, $domain]
    | unique
  ' <<<"$site"
)"

curl --fail --silent --show-error \
  -X PATCH \
  -H "$auth" \
  -H 'Content-Type: application/json' \
  --data "$(jq -nc --argjson aliases "$aliases" '{domain_aliases: $aliases}')" \
  "$api" >/dev/null

current="$(jq -r '.custom_domain // ""' <<<"$site")"
if [[ "$current" != "$NETLIFY_CUSTOM_DOMAIN" ]]; then
  response="$(mktemp)"
  trap 'rm -f "$response"' EXIT
  for attempt in 1 2 3 4; do
    status="$({ curl --silent --show-error \
      -o "$response" \
      -w '%{http_code}' \
      -X PATCH \
      -H "$auth" \
      -H 'Content-Type: application/json' \
      --data "$(jq -nc --arg domain "$NETLIFY_CUSTOM_DOMAIN" '{custom_domain: $domain}')" \
      "$api"; } || true)"
    if [[ "$status" =~ ^2 ]]; then
      break
    fi
    if [[ "$status" != "422" ]] || ! grep -qi 'provisioning a certificate' "$response"; then
      cat "$response" >&2
      exit 1
    fi
    if [[ "$attempt" -lt 4 ]]; then
      sleep 15
    fi
  done
fi

curl --silent --show-error -X POST -H "$auth" "$api/ssl" >/dev/null || true

site="$(curl --fail --silent --show-error -H "$auth" "$api")"
if ! jq -e --arg domain "$NETLIFY_CUSTOM_DOMAIN" '
  .custom_domain == $domain or ((.domain_aliases // []) | index($domain) != null)
' <<<"$site" >/dev/null; then
  echo "Netlify did not retain ${NETLIFY_CUSTOM_DOMAIN}." >&2
  exit 1
fi

if ! jq -e --arg legacy "$NETLIFY_LEGACY_DOMAIN" '(.domain_aliases // []) | index($legacy) != null' <<<"$site" >/dev/null; then
  echo "Netlify did not retain ${NETLIFY_LEGACY_DOMAIN} as an alias." >&2
  exit 1
fi

echo "Netlify now routes ${NETLIFY_CUSTOM_DOMAIN}."
