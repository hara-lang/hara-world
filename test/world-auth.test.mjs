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

function cookieHeader(setCookie) {
  return [WORLD_AUTH_STATE_COOKIE, WORLD_AUTH_VERIFIER_COOKIE].flatMap((name) => {
    const match = setCookie.match(new RegExp(`(?:^|,\\s*)(${name}=[^;]*)`));
    return match ? [match[1]] : [];
  }).join("; ");
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

test("exchanges the handoff server-to-server and creates a local session", async () => {
  const start = await handle(new Request("https://world.hara-lang.org/api/auth/start?returnTo=%2Fme"), { env: ENV, now: NOW });
  const cookies = cookieHeader(start.headers.get("set-cookie"));
  const parsed = parseCookies(cookies);
  const state = parsed[WORLD_AUTH_STATE_COOKIE];
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), init });
    return Response.json({
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
  };
  const callback = await handle(new Request(`https://world.hara-lang.org/api/auth/callback?code=code-12345678901234567890123456789012&state=${state}`, {
    headers: { Cookie: cookies },
  }), { env: ENV, fetchImpl, now: NOW + 1000, recordIdentityHandoffImpl: async (identity) => {
    assert.equal(identity.handoffIssuer, "https://id.hara-lang.org");
    return true;
  } });

  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get("location"), "https://world.hara-lang.org/me");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://id.hara-lang.org/v1/handoffs/token");
  assert.match(seen[0].init.headers.Authorization, /^Basic /);
  assert.doesNotMatch(seen[0].init.body, /repeat|HARA_WORLD_SESSION_SECRET/);
  assert.match(callback.headers.get("set-cookie"), new RegExp(WORLD_SESSION_COOKIE));
  assert.doesNotMatch(callback.headers.get("set-cookie"), /Domain=/i);

  const sessionCookie = callback.headers.get("set-cookie").match(new RegExp(`(${WORLD_SESSION_COOKIE}=[^;]+)`))[1];
  const session = await handle(new Request("https://world.hara-lang.org/api/auth/session", {
    headers: { Cookie: sessionCookie },
  }), { env: ENV, now: NOW + 2000 });
  const body = await session.json();
  assert.equal(body.authenticated, true);
  assert.equal(body.profile.id, "6685337");
  assert.equal(body.profile.login, "zcaudate");
  assert.equal(body.centralIssuer, "https://id.hara-lang.org");
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

test("clears the host-only World session only from the World origin", async () => {
  const rejected = await handle(new Request("https://world.hara-lang.org/api/auth/logout", {
    method: "POST",
    headers: { Origin: "https://evil.example" },
  }), { env: ENV });
  assert.equal(rejected.status, 403);

  const response = await handle(new Request("https://world.hara-lang.org/api/auth/logout", {
    method: "POST",
    headers: { Origin: "https://world.hara-lang.org", "X-Hara-Request": "world-sign-out" },
  }), { env: ENV });
  assert.equal(response.status, 204);
  assert.match(response.headers.get("set-cookie"), new RegExp(`${WORLD_SESSION_COOKIE}=;`));
});
