import assert from "node:assert/strict";
import test from "node:test";
import {
  WORLD_AUTH_STATE_COOKIE,
  WORLD_AUTH_VERIFIER_COOKIE,
  WORLD_SESSION_COOKIE,
  parseCookies,
} from "../netlify/functions/_shared/world-auth.mjs";
import { handle } from "../netlify/functions/world-auth.mjs";

const ENV = {
  HARA_WORLD_HANDOFF_SECRET: "h".repeat(64),
  HARA_WORLD_SESSION_SECRET: "s".repeat(64),
};
const NOW = Date.parse("2026-08-07T00:00:00Z");
const ACTIVE = async () => "active";

function cookieHeader(setCookie) {
  return [WORLD_AUTH_STATE_COOKIE, WORLD_AUTH_VERIFIER_COOKIE].flatMap((name) => {
    const match = setCookie.match(new RegExp(`(?:^|,\\s*)(${name}=[^;]*)`));
    return match ? [match[1]] : [];
  }).join("; ");
}

async function establishSession() {
  const start = await handle(new Request("https://world.hara-lang.org/api/auth/start?returnTo=%2Fme"), { env: ENV, now: NOW });
  const cookies = cookieHeader(start.headers.get("set-cookie"));
  const state = parseCookies(cookies)[WORLD_AUTH_STATE_COOKIE];
  const fetchImpl = async () => Response.json({
    tokenType: "Hara-Identity-Handoff",
    expiresIn: 60,
    handoff: {
      id: "handoff-01234567890123456789",
      issuer: "https://id.hara-lang.org",
      audience: "world",
      subject: "github:6685337",
      issuedAt: new Date(NOW).toISOString(),
      expiresAt: new Date(NOW + 60_000).toISOString(),
      identity: {
        provider: "github",
        id: "6685337",
        login: "zcaudate",
        name: "Chris",
        avatarUrl: "https://avatars.githubusercontent.com/u/6685337?v=4",
        profileUrl: "https://github.com/zcaudate",
      },
    },
  });
  const callback = await handle(new Request(`https://world.hara-lang.org/api/auth/callback?code=code-12345678901234567890123456789012&state=${state}`, {
    headers: { Cookie: cookies },
  }), {
    env: ENV,
    fetchImpl,
    now: NOW + 1000,
    recordIdentityHandoffImpl: async () => true,
  });
  const match = callback.headers.get("set-cookie").match(new RegExp(`(${WORLD_SESSION_COOKIE}=[^;]+)`));
  return { start, callback, sessionCookie: match[1] };
}

test("starts an exact World handoff with S256 PKCE and host-only cookies", async () => {
  const response = await handle(new Request("https://world.hara-lang.org/api/auth/start?returnTo=%2Fme"), { env: ENV, now: NOW });
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.origin, "https://id.hara-lang.org");
  assert.equal(location.pathname, "/v1/handoffs/authorize");
  assert.equal(location.searchParams.get("client_id"), "world");
  assert.equal(location.searchParams.get("redirect_uri"), "https://world.hara-lang.org/api/auth/callback");
  assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  const cookies = response.headers.get("set-cookie");
  assert.match(cookies, new RegExp(WORLD_AUTH_STATE_COOKIE));
  assert.match(cookies, new RegExp(WORLD_AUTH_VERIFIER_COOKIE));
  assert.doesNotMatch(cookies, /Domain=/i);
});

test("creates a local session and rechecks that the account remains active", async () => {
  const { callback, sessionCookie } = await establishSession();
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get("location"), "https://world.hara-lang.org/me");
  const session = await handle(new Request("https://world.hara-lang.org/api/auth/session", {
    headers: { Cookie: sessionCookie },
  }), { env: ENV, now: NOW + 2000, communityAccountStatusImpl: ACTIVE });
  const body = await session.json();
  assert.equal(body.authenticated, true);
  assert.equal(body.profile.id, "6685337");
  assert.equal(body.accountStatus, "active");
});

test("revokes an already-issued World session when the account is suspended", async () => {
  const { sessionCookie } = await establishSession();
  const response = await handle(new Request("https://world.hara-lang.org/api/auth/session", {
    headers: { Cookie: sessionCookie },
  }), { env: ENV, now: NOW + 2000, communityAccountStatusImpl: async () => "suspended" });
  const body = await response.json();
  assert.equal(body.authenticated, false);
  assert.equal(body.accountStatus, "suspended");
  assert.match(response.headers.get("set-cookie"), new RegExp(`${WORLD_SESSION_COOKIE}=;`));
});

test("rejects callback state mismatch before contacting Identity", async () => {
  let called = false;
  const response = await handle(new Request("https://world.hara-lang.org/api/auth/callback?code=code&state=wrong", {
    headers: { Cookie: `${WORLD_AUTH_STATE_COOKIE}=expected; ${WORLD_AUTH_VERIFIER_COOKIE}=${"v".repeat(48)}` },
  }), { env: ENV, fetchImpl: async () => { called = true; return Response.json({}); }, now: NOW });
  assert.equal(response.status, 302);
  assert.equal(called, false);
  assert.match(response.headers.get("location"), /auth_error=/);
});

test("supports same-origin POST logout and Identity front-channel logout", async () => {
  const rejected = await handle(new Request("https://world.hara-lang.org/api/auth/logout", {
    method: "POST",
    headers: { Origin: "https://evil.example" },
  }), { env: ENV });
  assert.equal(rejected.status, 403);

  const local = await handle(new Request("https://world.hara-lang.org/api/auth/logout", {
    method: "POST",
    headers: { Origin: "https://world.hara-lang.org", "X-Hara-Request": "world-sign-out" },
  }), { env: ENV });
  assert.equal(local.status, 204);
  assert.match(local.headers.get("set-cookie"), new RegExp(`${WORLD_SESSION_COOKIE}=;`));

  const global = await handle(new Request("https://world.hara-lang.org/api/auth/logout?source=hara-identity&returnTo=https%3A%2F%2Fpackages.hara-lang.org%2F"), { env: ENV });
  assert.equal(global.status, 302);
  assert.equal(global.headers.get("location"), "https://packages.hara-lang.org/");
  assert.match(global.headers.get("set-cookie"), new RegExp(`${WORLD_SESSION_COOKIE}=;`));

  const crossEnvironment = await handle(new Request("https://world.hara-lang.org/api/auth/logout?source=hara-identity&returnTo=https%3A%2F%2Fpackages.testing.hara-lang.org%2F"), { env: ENV });
  assert.equal(crossEnvironment.headers.get("location"), "https://world.hara-lang.org/");
});
