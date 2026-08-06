#!/usr/bin/env bash
set -euo pipefail

: "${WORLD_ORIGIN:?WORLD_ORIGIN is required}"
: "${IDENTITY_ORIGIN:?IDENTITY_ORIGIN is required}"
REQUIRE_IDENTITY_CONFIGURED="${REQUIRE_IDENTITY_CONFIGURED:-false}"

world_origin="${WORLD_ORIGIN%/}"
identity_origin="${IDENTITY_ORIGIN%/}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fetch_until() {
  local url="$1"
  local output="$2"
  for attempt in {1..20}; do
    if curl --fail --silent --show-error --location --max-time 20 "$url" >"$output"; then
      return 0
    fi
    if [[ "$attempt" -lt 20 ]]; then sleep 15; fi
  done
  echo "Could not fetch ${url}." >&2
  return 1
}

fetch_until "${world_origin}/" "$work/home.html"
grep -q 'property="og:site_name" content="Hara World"' "$work/home.html"
grep -q 'src="/identity-loader.js"' "$work/home.html"

fetch_until "${world_origin}/identity-loader.js" "$work/identity-loader.js"
grep -q '/identity-client.js' "$work/identity-loader.js"
grep -q 'id.testing.hara-lang.org' "$work/identity-loader.js"
grep -q 'id.hara-lang.org' "$work/identity-loader.js"

fetch_until "${world_origin}/me" "$work/me.html"
grep -q 'Your Hara identity' "$work/me.html"

fetch_until "${world_origin}/feed.xml" "$work/feed.xml"
grep -Eq '<rss|<feed' "$work/feed.xml"

fetch_until "${world_origin}/feed.json" "$work/feed.json"
jq -e '.version and (.items | type == "array")' "$work/feed.json" >/dev/null

fetch_until "${identity_origin}/.well-known/hara-session" "$work/identity.json"
jq -e --arg issuer "$identity_origin" --arg world "$world_origin" '
  .issuer == $issuer
  and (.allowedOrigins | index($world) != null)
' "$work/identity.json" >/dev/null

if [[ "$REQUIRE_IDENTITY_CONFIGURED" == "true" ]]; then
  jq -e '.configured == true' "$work/identity.json" >/dev/null
fi

echo "Verified Hara World at ${world_origin} with Identity at ${identity_origin}."
