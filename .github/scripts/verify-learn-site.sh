#!/usr/bin/env bash
set -euo pipefail

: "${LEARN_ORIGIN:?LEARN_ORIGIN is required}"
: "${IDENTITY_ORIGIN:?IDENTITY_ORIGIN is required}"
REQUIRE_IDENTITY_CONFIGURED="${REQUIRE_IDENTITY_CONFIGURED:-false}"
REQUIRE_LEARN_AUTH_CONFIGURED="${REQUIRE_LEARN_AUTH_CONFIGURED:-false}"
REQUIRE_PROFILE_PUBLISHER_CONFIGURED="${REQUIRE_PROFILE_PUBLISHER_CONFIGURED:-false}"

learn_origin="${LEARN_ORIGIN%/}"
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

fetch_until "${learn_origin}/" "$work/home.html"
grep -q 'property="og:site_name" content="Hara Learn"' "$work/home.html"
grep -q 'src="/identity-loader.js"' "$work/home.html"
fetch_until "${learn_origin}/identity-loader.js" "$work/identity-loader.js"
grep -q '/identity-client.js' "$work/identity-loader.js"
grep -q '/learn-session-sync.js' "$work/identity-loader.js"
fetch_until "${learn_origin}/learn-session-sync.js" "$work/learn-session-sync.js"
grep -q '/api/auth/session' "$work/learn-session-sync.js"
grep -q '/api/auth/logout' "$work/learn-session-sync.js"

fetch_until "${learn_origin}/me" "$work/me.html"
grep -q '>My Learn\.<' "$work/me.html"
grep -q 'Your proposal activity' "$work/me.html"
grep -q 'Submit profile for review' "$work/me.html"
fetch_until "${learn_origin}/review" "$work/review.html"
grep -q '>Review the Learn\.<' "$work/review.html"
grep -q 'Changes or failing checks' "$work/review.html"

fetch_until "${learn_origin}/feed.xml" "$work/feed.xml"
grep -Eq '<rss|<feed' "$work/feed.xml"
fetch_until "${learn_origin}/feed.json" "$work/feed.json"
jq -e '.version and (.items | type == "array")' "$work/feed.json" >/dev/null

fetch_until "${identity_origin}/.well-known/hara-session" "$work/identity.json"
jq -e --arg issuer "$identity_origin" --arg learn "$learn_origin" '.issuer == $issuer and (.allowedOrigins | index($learn) != null)' "$work/identity.json" >/dev/null
if [[ "$REQUIRE_IDENTITY_CONFIGURED" == "true" ]]; then jq -e '.configured == true' "$work/identity.json" >/dev/null; fi

fetch_until "${identity_origin}/.well-known/hara-handoff" "$work/handoff.json"
jq -e --arg issuer "$identity_origin" --arg callback "${learn_origin}/api/auth/callback" '
  .issuer == $issuer
  and any(.clients[]; .id == "learn" and .redirectUri == $callback)
  and (.codeChallengeMethodsSupported | index("S256") != null)
' "$work/handoff.json" >/dev/null
if [[ "$REQUIRE_LEARN_AUTH_CONFIGURED" == "true" ]]; then jq -e '.configured == true' "$work/handoff.json" >/dev/null; fi

fetch_until "${learn_origin}/.well-known/hara-learn" "$work/learn.json"
jq -e --arg issuer "$learn_origin" --arg central "$identity_origin" '
  .issuer == $issuer
  and .centralIssuer == $central
  and .readinessEndpoint == ($issuer + "/.well-known/hara-learn-readiness")
  and .authentication.accountStatusEnforced == true
  and .authentication.frontChannelLogout == true
  and .profiles.index == "registry/profiles.json"
  and .profiles.oneOpenProposalPerIdentity == true
  and .proposals.dashboard == ($issuer + "/me")
  and .proposals.endpoint == ($issuer + "/api/proposals")
  and .proposals.reconcileEndpoint == ($issuer + "/api/proposals/reconcile")
  and .proposals.reviewQueue == ($issuer + "/review")
  and .proposals.reviewEndpoint == ($issuer + "/api/review/proposals")
  and .proposals.webhookEndpoint == ($issuer + "/api/github/events")
  and .proposals.deliveryDeduplication == true
  and .proposals.reconciliationFallback == true
  and .proposals.publicationBoundary == "merge"
' "$work/learn.json" >/dev/null

if [[ "$REQUIRE_LEARN_AUTH_CONFIGURED" == "true" || "$REQUIRE_PROFILE_PUBLISHER_CONFIGURED" == "true" ]]; then
  fetch_until "${learn_origin}/.well-known/hara-learn-readiness" "$work/readiness.json"
  jq -e --arg issuer "$learn_origin" --arg central "$identity_origin" '
    .ready == true and .issuer == $issuer and .centralIssuer == $central
    and ([.checks[] | select(.ready != true)] | length) == 0
    and any(.checks[]; .name == "github-proposal-webhook" and .ready == true)
    and any(.checks[]; .name == "database" and .ready == true)
  ' "$work/readiness.json" >/dev/null
fi

status="$(curl --silent --show-error --max-time 20 --dump-header "$work/start.headers" --output "$work/start.body" --write-out '%{http_code}' "${learn_origin}/api/auth/start?returnTo=%2Fme")"
[[ "$status" == "302" ]]
location="$(header_value Location "$work/start.headers")"
node - "$location" "$identity_origin" "$learn_origin" <<'NODE'
const [location, identity, learn] = process.argv.slice(2);
const redirect = new URL(location);
if (redirect.origin !== identity || redirect.pathname !== "/v1/handoffs/authorize") process.exit(1);
if (redirect.searchParams.get("client_id") !== "learn") process.exit(1);
if (redirect.searchParams.get("redirect_uri") !== `${learn}/api/auth/callback`) process.exit(1);
if (redirect.searchParams.get("code_challenge_method") !== "S256") process.exit(1);
NODE

curl --fail --silent --show-error --max-time 20 "${learn_origin}/api/auth/session" >"$work/session.json"
jq -e '.authenticated == false' "$work/session.json" >/dev/null
if [[ "$REQUIRE_LEARN_AUTH_CONFIGURED" == "true" ]]; then jq -e '.configured == true' "$work/session.json" >/dev/null; fi

status="$(curl --silent --show-error --max-time 20 --output "$work/profile.json" --write-out '%{http_code}' "${learn_origin}/api/profile")"
[[ "$status" == "401" ]]
jq -e '.error.code == "LEARN_SESSION_REQUIRED"' "$work/profile.json" >/dev/null

status="$(curl --silent --show-error --max-time 20 --output "$work/proposals.json" --write-out '%{http_code}' "${learn_origin}/api/proposals")"
[[ "$status" == "401" ]]
jq -e '.error.code == "LEARN_SESSION_REQUIRED"' "$work/proposals.json" >/dev/null

status="$(curl --silent --show-error --max-time 20 --output "$work/review.json" --write-out '%{http_code}' "${learn_origin}/api/review/proposals")"
[[ "$status" == "401" ]]
jq -e '.error.code == "LEARN_SESSION_REQUIRED"' "$work/review.json" >/dev/null

status="$(curl --silent --show-error --max-time 20 --output "$work/webhook.json" --write-out '%{http_code}' "${learn_origin}/api/github/events")"
[[ "$status" == "405" ]]
jq -e '.error.code == "METHOD_NOT_ALLOWED"' "$work/webhook.json" >/dev/null

# Netlify preserves source query parameters on same-origin HTTP redirects. Learn therefore clears its cookie in an HTML bridge whose validated return link is exact and whose script uses that link directly.
logout_return="${learn_origin}/me"
learn_logout="${learn_origin}/api/auth/logout?source=hara-identity&returnTo=$(jq -rn --arg value "$logout_return" '$value|@uri')"
status="$(curl --silent --show-error --max-time 20 --dump-header "$work/learn-logout.headers" --output "$work/learn-logout.html" --write-out '%{http_code}' "$learn_logout")"
[[ "$status" == "200" ]]
grep -qi '^set-cookie: hara_learn_session=;.*Max-Age=0' "$work/learn-logout.headers"
grep -q "data-hara-logout-return href=\"${logout_return}\"" "$work/learn-logout.html"
grep -q 'location.replace' "$work/learn-logout.html"
if grep -Eq 'source=hara-identity|returnTo=' "$work/learn-logout.html"; then
  echo "The logout bridge leaked its source query into the return document." >&2
  exit 1
fi

echo "Verified Hara Learn at ${learn_origin} with proposal lifecycle readiness, account enforcement, and exact front-channel logout."
