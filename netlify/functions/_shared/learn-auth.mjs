import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getEnv } from "./env.mjs";

export const LEARN_SESSION_COOKIE = "hara_learn_session";
export const LEARN_AUTH_STATE_COOKIE = "hara_learn_auth_state";
export const LEARN_AUTH_VERIFIER_COOKIE = "hara_learn_auth_verifier";
export const LEARN_AUTH_RETURN_COOKIE = "hara_learn_auth_return";
export const LEARN_AUTH_COOKIE_TTL_SECONDS = 10 * 60;
export const LEARN_SESSION_TTL_SECONDS = 2 * 60 * 60;
export const LEARN_CLIENT_ID = "learn";

const LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const COOKIE_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function envValue(env, name, fallback = "") {
  const injected = env?.[name];
  if (typeof injected === "string" && injected.trim()) return injected.trim();
  return String(getEnv(name, fallback) ?? fallback).trim();
}

function isLoopback(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function base64Url(value) {
  return Buffer.isBuffer(value) ? value.toString("base64url") : Buffer.from(value).toString("base64url");
}

function safeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function pkceChallenge(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function parseCookies(header = "") {
  const output = {};
  for (const part of String(header).split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    try {
      output[name] = decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      output[name] = part.slice(separator + 1).trim();
    }
  }
  return output;
}

function isSecure(requestUrl) {
  return new URL(requestUrl).protocol === "https:";
}

export function serializeCookie(name, value, {
  path = "/",
  maxAge,
  secure = true,
  httpOnly = true,
  sameSite = "Lax",
} = {}) {
  if (!COOKIE_NAME_PATTERN.test(name)) throw new TypeError(`Invalid cookie name: ${name}`);
  const parts = [`${name}=${encodeURIComponent(String(value))}`, `Path=${path}`];
  if (Number.isFinite(maxAge)) parts.push(`Max-Age=${Math.trunc(maxAge)}`);
  if (secure) parts.push("Secure");
  if (httpOnly) parts.push("HttpOnly");
  if (sameSite) parts.push(`SameSite=${sameSite}`);
  return parts.join("; ");
}

export function clearCookie(name, options = {}) {
  return serializeCookie(name, "", { ...options, maxAge: 0 });
}

export function appendCookies(headers, cookies) {
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return headers;
}

export function json(status, body, headers = {}) {
  return new Response(`${JSON.stringify(body)}\n`, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

export function redirect(location, cookies = [], status = 302) {
  const headers = appendCookies(new Headers({
    Location: location,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  }), cookies);
  return new Response(null, { status, headers });
}

export function identityOriginForRequest(requestUrl, env = {}) {
  const request = new URL(requestUrl);
  const configured = envValue(env, "HARA_IDENTITY_ORIGIN");
  if (configured) {
    const origin = new URL(configured).origin;
    const host = new URL(origin).hostname;
    if (
      origin !== "https://id.hara-lang.org"
      && origin !== "https://id.testing.hara-lang.org"
      && !isLoopback(host)
    ) {
      throw new Error("HARA_IDENTITY_ORIGIN is not an approved Hara Identity origin.");
    }
    return origin;
  }
  if (isLoopback(request.hostname)) return "http://localhost:9999";
  return request.hostname === "learn.testing.hara-lang.org" || request.hostname.endsWith(".testing.hara-lang.org")
    ? "https://id.testing.hara-lang.org"
    : "https://id.hara-lang.org";
}

export function learnOrigin(requestUrl) {
  return new URL(requestUrl).origin;
}

export function learnCallbackUri(requestUrl) {
  return new URL("/api/auth/callback", learnOrigin(requestUrl)).toString();
}

export function safeLocalReturnTo(value, requestUrl) {
  const request = new URL(requestUrl);
  const fallback = new URL("/me", request.origin).toString();
  if (typeof value !== "string" || !value.trim() || /[\r\n\0\\]/.test(value)) return fallback;
  try {
    const target = new URL(value, request.origin);
    if (target.origin !== request.origin || !/^https?:$/.test(target.protocol)) return fallback;
    return target.toString();
  } catch {
    return fallback;
  }
}

export function readLearnAuthConfig(env = {}, requestUrl = "https://learn.hara-lang.org/") {
  const handoffSecret = envValue(env, "HARA_LEARN_HANDOFF_SECRET");
  const sessionSecret = envValue(env, "HARA_LEARN_SESSION_SECRET");
  if (handoffSecret.length < 32 || sessionSecret.length < 32) {
    throw new Error("Hara Learn authentication is not configured.");
  }
  return {
    clientId: LEARN_CLIENT_ID,
    handoffSecret,
    sessionSecret,
    identityOrigin: identityOriginForRequest(requestUrl, env),
    redirectUri: learnCallbackUri(requestUrl),
  };
}

export function isLearnAuthConfigured(env = {}, requestUrl = "https://learn.hara-lang.org/") {
  try {
    readLearnAuthConfig(env, requestUrl);
    return true;
  } catch {
    return false;
  }
}

export function createLearnAuthAttempt(returnTo, requestUrl) {
  const verifier = randomToken(48);
  return {
    state: randomToken(32),
    verifier,
    challenge: pkceChallenge(verifier),
    returnTo: safeLocalReturnTo(returnTo, requestUrl),
  };
}

export function authAttemptCookies(attempt, requestUrl) {
  const options = {
    path: "/api/auth/callback",
    maxAge: LEARN_AUTH_COOKIE_TTL_SECONDS,
    secure: isSecure(requestUrl),
    httpOnly: true,
    sameSite: "Lax",
  };
  return [
    serializeCookie(LEARN_AUTH_STATE_COOKIE, attempt.state, options),
    serializeCookie(LEARN_AUTH_VERIFIER_COOKIE, attempt.verifier, options),
    serializeCookie(LEARN_AUTH_RETURN_COOKIE, attempt.returnTo, options),
  ];
}

export function clearAuthAttemptCookies(requestUrl) {
  const options = {
    path: "/api/auth/callback",
    secure: isSecure(requestUrl),
    httpOnly: true,
    sameSite: "Lax",
  };
  return [
    clearCookie(LEARN_AUTH_STATE_COOKIE, options),
    clearCookie(LEARN_AUTH_VERIFIER_COOKIE, options),
    clearCookie(LEARN_AUTH_RETURN_COOKIE, options),
  ];
}

export function assertLearnCallback(requestUrl, cookieHeader) {
  const url = new URL(requestUrl);
  const cookies = parseCookies(cookieHeader);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = cookies[LEARN_AUTH_STATE_COOKIE];
  const verifier = cookies[LEARN_AUTH_VERIFIER_COOKIE];
  if (!code || !state || !expectedState || !safeEqual(state, expectedState)) {
    throw new Error("The Learn identity handoff state is invalid or expired.");
  }
  if (!verifier || verifier.length < 43) {
    throw new Error("The Learn identity handoff verifier is missing or expired.");
  }
  return {
    code,
    verifier,
    returnTo: safeLocalReturnTo(cookies[LEARN_AUTH_RETURN_COOKIE], requestUrl),
  };
}

export function validateHandoffPayload(payload, config, now = Date.now()) {
  const handoff = payload?.handoff;
  const identity = handoff?.identity;
  if (
    payload?.tokenType !== "Hara-Identity-Handoff"
    || typeof handoff?.id !== "string"
    || handoff.id.length < 20
    || handoff.id.length > 200
    || handoff.issuer !== config.identityOrigin
    || handoff.audience !== config.clientId
    || typeof handoff.subject !== "string"
    || identity?.provider !== "github"
    || typeof identity?.id !== "string"
    || !/^\d+$/.test(identity.id)
    || handoff.subject !== `github:${identity.id}`
    || typeof identity.login !== "string"
    || !LOGIN_PATTERN.test(identity.login)
    || !Number.isFinite(Date.parse(handoff.issuedAt))
    || Date.parse(handoff.issuedAt) > now + 60_000
    || Date.parse(handoff.expiresAt) <= now
    || Date.parse(handoff.expiresAt) > now + 120_000
  ) {
    throw new Error("Identity returned an invalid Learn handoff.");
  }
  return {
    handoffId: handoff.id,
    handoffIssuer: handoff.issuer,
    handoffAudience: handoff.audience,
    handoffExpiresAt: handoff.expiresAt,
    id: identity.id,
    login: identity.login,
    name: typeof identity.name === "string" ? identity.name : null,
    avatarUrl: typeof identity.avatarUrl === "string" ? identity.avatarUrl : `https://avatars.githubusercontent.com/u/${identity.id}?v=4`,
    profileUrl: typeof identity.profileUrl === "string" ? identity.profileUrl : `https://github.com/${identity.login}`,
  };
}

export function signLearnSession(identity, secret, {
  issuer,
  now = Date.now(),
  ttlSeconds = LEARN_SESSION_TTL_SECONDS,
} = {}) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("Learn session secret is not configured.");
  if (!identity?.handoffId || !/^\d+$/.test(identity?.id ?? "") || !LOGIN_PATTERN.test(identity?.login ?? "")) {
    throw new TypeError("A verified Hara identity handoff is required.");
  }
  const issuedAt = Math.floor(now / 1000);
  const payload = {
    v: 1,
    iss: new URL(issuer).origin,
    aud: "hara-learn",
    sub: `github:${identity.id}`,
    id: identity.id,
    login: identity.login,
    name: identity.name ?? null,
    avatarUrl: identity.avatarUrl,
    profileUrl: identity.profileUrl,
    handoffId: identity.handoffId,
    iat: issuedAt,
    exp: issuedAt + Math.max(60, Math.trunc(ttlSeconds)),
  };
  const encoded = base64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyLearnSession(token, secret, {
  issuer,
  now = Date.now(),
} = {}) {
  if (typeof token !== "string" || typeof secret !== "string" || secret.length < 32) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const expected = createHmac("sha256", secret).update(parts[0]).digest("base64url");
  if (!safeEqual(parts[1], expected)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const nowSeconds = Math.floor(now / 1000);
  if (
    payload?.v !== 1
    || payload.iss !== new URL(issuer).origin
    || payload.aud !== "hara-learn"
    || payload.sub !== `github:${payload.id}`
    || typeof payload.id !== "string"
    || !/^\d+$/.test(payload.id)
    || typeof payload.login !== "string"
    || !LOGIN_PATTERN.test(payload.login)
    || typeof payload.handoffId !== "string"
    || !Number.isSafeInteger(payload.iat)
    || !Number.isSafeInteger(payload.exp)
    || payload.iat > nowSeconds + 60
    || payload.exp <= nowSeconds
  ) return null;
  return {
    id: payload.id,
    provider: "github",
    login: payload.login,
    name: typeof payload.name === "string" ? payload.name : null,
    avatarUrl: payload.avatarUrl,
    profileUrl: payload.profileUrl,
    handoffId: payload.handoffId,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

export function learnSessionCookie(token, requestUrl) {
  return serializeCookie(LEARN_SESSION_COOKIE, token, {
    path: "/",
    maxAge: LEARN_SESSION_TTL_SECONDS,
    secure: isSecure(requestUrl),
    httpOnly: true,
    sameSite: "Lax",
  });
}

export function clearLearnSessionCookie(requestUrl) {
  return clearCookie(LEARN_SESSION_COOKIE, {
    path: "/",
    secure: isSecure(requestUrl),
    httpOnly: true,
    sameSite: "Lax",
  });
}

export function readLearnSession(request, env = {}, now = Date.now()) {
  if (!isLearnAuthConfigured(env, request.url)) return null;
  const config = readLearnAuthConfig(env, request.url);
  const cookies = parseCookies(request.headers.get("cookie") || "");
  return verifyLearnSession(cookies[LEARN_SESSION_COOKIE], config.sessionSecret, {
    issuer: learnOrigin(request.url),
    now,
  });
}

export function sameOrigin(request, env = {}) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const allowed = new Set([new URL(request.url).origin]);
  const configured = envValue(env, "HARA_LEARN_SITE");
  if (configured) {
    try { allowed.add(new URL(configured).origin); } catch {}
  }
  return allowed.has(origin);
}
