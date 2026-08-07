#!/usr/bin/env bash
set -euo pipefail

: "${WORLD_ORIGIN:?WORLD_ORIGIN is required}"
: "${IDENTITY_ORIGIN:?IDENTITY_ORIGIN is required}"
REQUIRE_IDENTITY_CONFIGURED="${REQUIRE_IDENTITY_CONFIGURED:-false}"
REQUIRE_WORLD_AUTH_CONFIGURED="${REQUIRE_WORLD_AUTH_CONFIGURED:-false}"
REQUIRE_PROFILE_PUBLISHER_CONFIGURED="${REQUIRE_PROFILE_PUBLISHER_CONFIGURED:-false}"

world_origin="${WORLD_ORIGIN%/}"
identity_origin="${IDENTITY_ORIGIN%/}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fetch_until() {
  local url="$1" output="$2"
  for attempt in {1..20}; do
    if curl --fail --silent --show-error --location --max-time 20 "$url" >"$output"; then return 0; fi
    if [[ "$attempt" -lt 20 ]]; then sleep 15; fi
  done
  echo "Could not fetch ${url}." >&2
  return 1
}

header_value() {
  local name="$1" file="$2"
  awk -v target="${name,,}" 'BEGIN{IGNORECASE=1} {key=$1; sub(/:$/, "", key); if(tolower(key)==target){$1=""; sub(/^[[:space:]]+/, ""); sub(/\r$/, ""); print; exit}}' "$file"
}

fetch_until "${world_origin}/" "$work/home.html"
grep -q 'property="og:site_name" content="Hara World"' "$work/home.html"
grep -q 'src="/identity-loader.js"' "$work/home.html"
fetch_until "${world_origin}/identity-loader.js" "$work/identity-loader.js"
grep -q '/identity-client.js' "$work/identity-loader.js"
grep -q '/world-session-sync.js' "$work/identity-loader.js"
fetch_until "${world_origin}/world-session-sync.js" "$work/world-session-sync.js"
grep -q '/api/auth/session' "$work/world-session-sync.js"
grep -q '/api/auth/logout' "$work/world-session-sync.js"

fetch_until "${world_origin}/me" "$work/me.html"
grep -q 'Your Hara World account' "$work/me.html"
grep -q 'Open draft profile PR' "$work/me.html"
fetch_until "${world_origin}/feed.xml" "$work/feed.xml"
grep -Eq '<rss|<feed' "$work/feed.xml"
fetch_until "${world_origin}/feed.json" "$work/feed.json"
jq -e '.version and (.items | type == "array")' "$work/feed.json" >/dev/null

fetch_until "${identity_origin}/.well-known/hara-session" "$work/identity.json"
jq -e --arg issuer "$identity_origin" --arg world "$world_origin" '.issuer == $issuer and (.allowedOrigins | index($world) != null)' "$work/identity.json" >/dev/null
if [[ "$REQUIRE_IDENTITY_CONFIGURED" == "true" ]]; then jq -e '.configured == true' "$work/identity.json" >/dev/null; fi

fetch_until "${identity_origin}/.well-known/hara-handoff" "$work/handoff.json"
jq -e --arg issuer "$identity_origin" --arg callback "${world_origin}/api/auth/callback" '
  .issuer == $issuer
  and any(.clients[]; .id == "world" and .redirectUri == $callback)
  and (.codeChallengeMethodsSupported | index("S256") != null)
' "$work/handoff.json" >/dev/null
if [[ "$REQUIRE_WORLD_AUTH_CONFIGURED" == "true" ]]; then jq -e '.configured == true' "$work/handoff.json" >/dev/null; fi

fetch_until "${world_origin}/.well-known/hara-world" "$work/world.json"
jq -e --arg issuer "$world_origin" --arg central "$identity_origin" '
  .issuer == $issuer
  and .centralIssuer == $central
  and .readinessEndpoint == ($issuer + "/.well-known/hara-world-readiness")
  and .authentication.accountStatusEnforced == true
  and .authentication.frontChannelLogout == true
  and .profiles.index == "registry/profiles.json"
  and .profiles.oneOpenProposalPerIdentity == true
' "$work/world.json" >/dev/null

if [[ "$REQUIRE_WORLD_AUTH_CONFIGURED" == "true" || "$REQUIRE_PROFILE_PUBLISHER_CONFIGURED" == "true" ]]; then
  fetch_until "${world_origin}/.well-known/hara-world-readiness" "$work/readiness.json"
  jq -e --arg issuer "$world_origin" --arg central "$identity_origin" '
    .ready == true and .issuer == $issuer and .centralIssuer == $central
    and ([.checks[] | select(.ready != true)] | length) == 0
  ' "$work/readiness.json" >/dev/null
fi

status="$(curl --silent --show-error --max-time 20 --dump-header "$work/start.headers" --output "$work/start.body" --write-out '%{http_code}' "${world_origin}/api/auth/start?returnTo=%2Fme")"
[[ "$status" == "302" ]]
location="$(header_value Location "$work/start.headers")"
node - "$location" "$identity_origin" "$world_origin" <<'NODE'
const [location, identity, world] = process.argv.slice(2);
const redirect = new URL(location);
if (redirect.origin !== identity || redirect.pathname !== "/v1/handoffs/authorize") process.exit(1);
if (redirect.searchParams.get("client_id") !== "world") process.exit(1);
if (redirect.searchParams.get("redirect_uri") !== `${world}/api/auth/callback`) process.exit(1);
if (redirect.searchParams.get("code_challenge_method") !== "S256") process.exit(1);
NODE

curl --fail --silent --show-error --max-time 20 "${world_origin}/api/auth/session" >"$work/session.json"
jq -e '.authenticated == false' "$work/session.json" >/dev/null
if [[ "$REQUIRE_WORLD_AUTH_CONFIGURED" == "true" ]]; then jq -e '.configured == true' "$work/session.json" >/dev/null; fi

status="$(curl --silent --show-error --max-time 20 --output "$work/profile.json" --write-out '%{http_code}' "${world_origin}/api/profile")"
[[ "$status" == "401" ]]
jq -e '.error.code == "WORLD_SESSION_REQUIRED"' "$work/profile.json" >/dev/null

# Netlify preserves source query parameters on same-origin HTTP redirects. World therefore clears its cookie in an HTML bridge whose validated return link is exact and whose script uses that link directly.
logout_return="${world_origin}/me"
world_logout="${world_origin}/api/auth/logout?source=hara-identity&returnTo=$(jq -rn --arg value "$logout_return" '$value|@uri')"
status="$(curl --silent --show-error --max-time 20 --dump-header "$work/world-logout.headers" --output "$work/world-logout.html" --write-out '%{http_code}' "$world_logout")"
[[ "$status" == "200" ]]
grep -qi '^set-cookie: hara_world_session=;.*Max-Age=0' "$work/world-logout.headers"
grep -q "data-hara-logout-return href=\"${logout_return}\"" "$work/world-logout.html"
grep -q 'location.replace' "$work/world-logout.html"
if grep -Eq 'source=hara-identity|returnTo=' "$work/world-logout.html"; then
  echo "The logout bridge leaked its source query into the return document." >&2
  exit 1
fi

echo "Verified Hara World at ${world_origin} with active readiness, account enforcement, and exact front-channel logout."
