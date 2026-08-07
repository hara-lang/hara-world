import { communityAccountStatus, recordIdentityHandoff } from "./_shared/community-accounts.mjs";
import {
  WORLD_SESSION_COOKIE,
  appendCookies,
  assertWorldCallback,
  authAttemptCookies,
  clearAuthAttemptCookies,
  clearWorldSessionCookie,
  createWorldAuthAttempt,
  identityOriginForRequest,
  isWorldAuthConfigured,
  json,
  parseCookies,
  readWorldAuthConfig,
  redirect,
  sameOrigin,
  signWorldSession,
  validateHandoffPayload,
  verifyWorldSession,
  worldOrigin,
  worldSessionCookie,
} from "./_shared/world-auth.mjs";

const START_PATH = "/api/auth/start";
const CALLBACK_PATH = "/api/auth/callback";
const SESSION_PATH = "/api/auth/session";
const LOGOUT_PATH = "/api/auth/logout";

const PRODUCTION_RETURN_ORIGINS = new Set([
  "https://hara-lang.org",
  "https://www.hara-lang.org",
  "https://world.hara-lang.org",
  "https://specs.hara-lang.org",
  "https://packages.hara-lang.org",
  "https://id.hara-lang.org",
]);
const TESTING_RETURN_ORIGINS = new Set([
  "https://www.testing.hara-lang.org",
  "https://world.testing.hara-lang.org",
  "https://specs.testing.hara-lang.org",
  "https://packages.testing.hara-lang.org",
  "https://id.testing.hara-lang.org",
]);

function authErrorRedirect(request, message) {
  const target = new URL("/me", request.url);
  target.searchParams.set("auth_error", String(message || "World authentication is unavailable.").slice(0, 180));
  return redirect(target.toString(), clearAuthAttemptCookies(request.url));
}

function safeGlobalReturnTo(value, requestUrl) {
  const request = new URL(requestUrl);
  const fallback = new URL("/", request.origin).toString();
  if (typeof value !== "string" || !value.trim() || /[\r\n\0\\]/.test(value)) return fallback;
  let target;
  try { target = new URL(value, request.origin); } catch { return fallback; }
  const testing = request.hostname === "world.testing.hara-lang.org"
    || request.hostname.endsWith(".testing.hara-lang.org");
  const allowed = testing ? TESTING_RETURN_ORIGINS : PRODUCTION_RETURN_ORIGINS;
  if (!allowed.has(target.origin) || target.protocol !== "https:" || target.username || target.password) return fallback;
  return target.toString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function frontChannelLogoutResponse(request) {
  const url = new URL(request.url);
  const returnTo = safeGlobalReturnTo(url.searchParams.get("returnTo"), request.url);
  const href = escapeHtml(returnTo);
  const body = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>Signing out · Hara World</title>
</head>
<body>
  <p>Hara World signed out.</p>
  <p><a data-hara-logout-return href="${href}">Continue</a></p>
  <script>location.replace(document.querySelector("[data-hara-logout-return]").href)</script>
</body>
</html>`;
  const headers = appendCookies(new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  }), [clearWorldSessionCookie(request.url)]);
  return new Response(body, { status: 200, headers });
}

function jsonWithCookies(status, body, cookies = []) {
  const headers = appendCookies(new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  }), cookies);
  return new Response(`${JSON.stringify(body)}\n`, { status, headers });
}

async function start(request, env) {
  if (request.method !== "GET") return json(405, { error: { code: "METHOD_NOT_ALLOWED", message: "Only GET is supported." } }, { Allow: "GET" });
  const config = readWorldAuthConfig(env, request.url);
  const url = new URL(request.url);
  const attempt = createWorldAuthAttempt(url.searchParams.get("returnTo") ?? "/me", request.url);
  const authorize = new URL("/v1/handoffs/authorize", config.identityOrigin);
  authorize.searchParams.set("client_id", config.clientId);
  authorize.searchParams.set("redirect_uri", config.redirectUri);
  authorize.searchParams.set("state", attempt.state);
  authorize.searchParams.set("code_challenge", attempt.challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  return redirect(authorize.toString(), authAttemptCookies(attempt, request.url));
}

async function callback(request, env, fetchImpl, now, recordIdentity) {
  if (request.method !== "GET") return json(405, { error: { code: "METHOD_NOT_ALLOWED", message: "Only GET is supported." } }, { Allow: "GET" });
  let callbackData;
  try {
    callbackData = assertWorldCallback(request.url, request.headers.get("cookie") || "");
  } catch (error) {
    return authErrorRedirect(request, error.message);
  }

  const config = readWorldAuthConfig(env, request.url);
  let response;
  try {
    response = await fetchImpl(new URL("/v1/handoffs/token", config.identityOrigin), {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.handoffSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "hara-world",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: callbackData.code,
        code_verifier: callbackData.verifier,
        redirect_uri: config.redirectUri,
      }).toString(),
    });
  } catch {
    return authErrorRedirect(request, "Identity could not be reached to establish the World session.");
  }

  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) return authErrorRedirect(request, payload?.error?.message || "Identity rejected the World session handoff.");

  let identity;
  try { identity = validateHandoffPayload(payload, config, now); }
  catch (error) { return authErrorRedirect(request, error.message); }

  let accepted;
  try { accepted = await recordIdentity(identity); }
  catch { return authErrorRedirect(request, "World could not record the identity handoff."); }
  if (!accepted) return authErrorRedirect(request, "This identity handoff is unavailable, has already been used, or the account is inactive.");

  const token = signWorldSession(identity, config.sessionSecret, { issuer: worldOrigin(request.url), now });
  return redirect(callbackData.returnTo, [
    ...clearAuthAttemptCookies(request.url),
    worldSessionCookie(token, request.url),
  ]);
}

async function session(request, env, now, accountStatus) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json(405, { error: { code: "METHOD_NOT_ALLOWED", message: "Only GET and HEAD are supported." } }, { Allow: "GET, HEAD" });
  }
  const configured = isWorldAuthConfigured(env, request.url);
  let profile = null;
  if (configured) {
    const config = readWorldAuthConfig(env, request.url);
    const cookies = parseCookies(request.headers.get("cookie") || "");
    profile = verifyWorldSession(cookies[WORLD_SESSION_COOKIE], config.sessionSecret, {
      issuer: worldOrigin(request.url),
      now,
    });
  }

  let accountStatusValue = profile ? "checking" : null;
  if (profile) {
    try {
      accountStatusValue = await accountStatus(profile.id);
    } catch {
      return json(503, { error: { code: "WORLD_ACCOUNT_CHECK_FAILED", message: "World could not verify the community account." } });
    }
    if (accountStatusValue !== "active") {
      const body = {
        authenticated: false,
        configured,
        issuer: worldOrigin(request.url),
        centralIssuer: identityOriginForRequest(request.url, env),
        profile: null,
        identity: null,
        accountStatus: accountStatusValue,
      };
      const response = jsonWithCookies(200, body, [clearWorldSessionCookie(request.url)]);
      return request.method === "HEAD"
        ? new Response(null, { status: 200, headers: response.headers })
        : response;
    }
  }

  const body = {
    authenticated: Boolean(profile),
    configured,
    issuer: worldOrigin(request.url),
    centralIssuer: identityOriginForRequest(request.url, env),
    profile,
    identity: profile ? { provider: "github", subject: profile.id, login: profile.login } : null,
    accountStatus: accountStatusValue,
  };
  if (request.method === "HEAD") return new Response(null, { status: 200, headers: { "cache-control": "no-store" } });
  return json(200, body);
}

function logout(request, env) {
  if (request.method === "GET") {
    const url = new URL(request.url);
    if (url.searchParams.get("source") !== "hara-identity") {
      return json(400, { error: { code: "LOGOUT_SOURCE_INVALID", message: "The front-channel logout source is invalid." } });
    }
    return frontChannelLogoutResponse(request);
  }
  if (request.method !== "POST") return json(405, { error: { code: "METHOD_NOT_ALLOWED", message: "Only GET and POST are supported." } }, { Allow: "GET, POST" });
  if (
    !sameOrigin(request, env)
    || !["world-sign-out", "central-sign-out"].includes(request.headers.get("x-hara-request"))
  ) return json(403, { error: { code: "ORIGIN_NOT_ALLOWED", message: "The logout request must come from Hara World." } });
  const headers = appendCookies(new Headers({ "Cache-Control": "no-store" }), [clearWorldSessionCookie(request.url)]);
  return new Response(null, { status: 204, headers });
}

export async function handle(request, {
  env = {},
  fetchImpl = fetch,
  now = Date.now(),
  recordIdentityHandoffImpl = recordIdentityHandoff,
  communityAccountStatusImpl = communityAccountStatus,
} = {}) {
  const pathname = new URL(request.url).pathname;
  try {
    if (pathname === START_PATH) return await start(request, env);
    if (pathname === CALLBACK_PATH) return await callback(request, env, fetchImpl, now, (identity) => recordIdentityHandoffImpl(identity));
    if (pathname === SESSION_PATH) return await session(request, env, now, (id) => communityAccountStatusImpl(id));
    if (pathname === LOGOUT_PATH) return logout(request, env);
    return json(404, { error: { code: "NOT_FOUND", message: "Unknown Hara World authentication endpoint." } });
  } catch (error) {
    if (pathname === START_PATH || pathname === CALLBACK_PATH) return authErrorRedirect(request, error.message || "World authentication is unavailable.");
    return json(503, { error: { code: "WORLD_AUTH_UNAVAILABLE", message: "Hara World authentication is unavailable." } });
  }
}

export default async (request) => handle(request);

export const config = {
  path: [
    "/api/auth/start",
    "/api/auth/callback",
    "/api/auth/session",
    "/api/auth/logout",
  ],
  rateLimit: {
    windowLimit: 120,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};
