import assert from "node:assert/strict";
import test from "node:test";
import { handle as handleProposals } from "../netlify/functions/proposals.mjs";
import { handle as handleReview } from "../netlify/functions/review-proposals.mjs";
import { WORLD_SESSION_COOKIE, signWorldSession } from "../netlify/functions/_shared/world-auth.mjs";

const ENV = {
  HARA_WORLD_HANDOFF_SECRET: "h".repeat(64),
  HARA_WORLD_SESSION_SECRET: "s".repeat(64),
  HARA_WORLD_SITE: "https://world.hara-lang.org",
};
const NOW = Date.parse("2026-08-18T04:00:00Z");
const IDENTITY = {
  handoffId: "handoff-01234567890123456789",
  id: "6685337",
  login: "zcaudate",
  name: "Chris Zheng",
};

function sessionCookie() {
  const token = signWorldSession(IDENTITY, ENV.HARA_WORLD_SESSION_SECRET, {
    issuer: "https://world.hara-lang.org",
    now: NOW,
  });
  return `${WORLD_SESSION_COOKIE}=${encodeURIComponent(token)}`;
}

function request(path, { method = "GET", marker } = {}) {
  return new Request(`https://world.hara-lang.org${path}`, {
    method,
    headers: {
      Cookie: sessionCookie(),
      Origin: "https://world.hara-lang.org",
      ...(marker ? { "X-Hara-Request": marker } : {}),
    },
  });
}

function proposal(overrides = {}) {
  return {
    proposalId: "proposal:post:111111111111111111111111",
    proposalType: "post",
    ownerGithubUserId: "6685337",
    resourceKey: "11111111-1111-4111-8111-111111111111",
    resourceTitle: "Small Hara agent",
    repository: "hara-lang/hara-world",
    branch: "post/github-6685337/1111111111114111",
    baseBranch: "main",
    pullRequestNumber: 42,
    pullRequestUrl: "https://github.com/hara-lang/hara-world/pull/42",
    publicPath: "/articles/community/2026/08/small-hara-agent",
    state: "submitted",
    reviewState: "pending",
    checksState: "unknown",
    isDraft: true,
    updatedAt: "2026-08-18T03:00:00Z",
    ...overrides,
  };
}

test("requires an active World session before exposing a contributor proposal list", async () => {
  const unauthenticated = await handleProposals(new Request("https://world.hara-lang.org/api/proposals"), { env: ENV, now: NOW });
  assert.equal(unauthenticated.status, 401);

  const inactive = await handleProposals(request("/api/proposals"), {
    env: ENV,
    now: NOW,
    communityAccountStatusImpl: async () => "suspended",
    proposalStore: { listForOwner: async () => [] },
  });
  assert.equal(inactive.status, 403);
  assert.match(inactive.headers.get("set-cookie"), new RegExp(`${WORLD_SESSION_COOKIE}=;`));
});

test("returns only the signed-in owner's lifecycle records and summary counts", async () => {
  const owners = [];
  const response = await handleProposals(request("/api/proposals"), {
    env: ENV,
    now: NOW,
    communityAccountStatusImpl: async () => "active",
    proposalStore: {
      async listForOwner(owner) {
        owners.push(owner);
        return [proposal(), proposal({ proposalId: "proposal:agent:222222222222222222222222", state: "merged", proposalType: "agent" })];
      },
    },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(owners, ["6685337"]);
  assert.equal(body.proposals.length, 2);
  assert.equal(body.counts.open, 1);
  assert.equal(body.counts.merged, 1);
});

test("reconciliation discovers missed owner proposals before refreshing open states", async () => {
  const calls = [];
  let listCount = 0;
  const response = await handleProposals(request("/api/proposals/reconcile", {
    method: "POST",
    marker: "proposal-reconcile",
  }), {
    env: ENV,
    now: NOW,
    communityAccountStatusImpl: async () => "active",
    githubClient: { repository: "hara-lang/hara-world", baseBranch: "main", async request() { throw new Error("not called"); } },
    proposalStore: {
      async listForOwner(owner) {
        calls.push(["list", owner]);
        listCount += 1;
        return listCount === 1 ? [] : [proposal()];
      },
    },
    discoverManagedProposalsImpl: async (_client, options) => {
      calls.push(["discover", options.ownerGithubUserId]);
      return [{ ok: true, proposal: proposal() }];
    },
    reconcileProposalsImpl: async (items) => {
      calls.push(["reconcile", items.length]);
      return items.map((item) => ({ ok: true, proposal: { ...item, checksState: "passing" } }));
    },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.discovered[0].ok, true);
  assert.equal(body.reconciled[0].ok, true);
  assert.deepEqual(calls.slice(0, 4), [
    ["list", "6685337"],
    ["discover", "6685337"],
    ["list", "6685337"],
    ["reconcile", 1],
  ]);

  const rejected = await handleProposals(request("/api/proposals/reconcile", { method: "POST" }), {
    env: ENV,
    now: NOW,
    communityAccountStatusImpl: async () => "active",
  });
  assert.equal(rejected.status, 403);
});

test("review queue requires repository or reviewed profile authority", async () => {
  const denied = await handleReview(request("/api/review/proposals"), {
    env: ENV,
    now: NOW,
    communityAccountStatusImpl: async () => "active",
    githubClient: { repository: "hara-lang/hara-world", baseBranch: "main", async request() {} },
    reviewAccessImpl: async () => ({ allowed: false, source: "none", roles: [] }),
    reviewStore: { list: async () => [proposal()] },
  });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, "REVIEW_ACCESS_REQUIRED");

  const allowed = await handleReview(request("/api/review/proposals"), {
    env: ENV,
    now: NOW,
    communityAccountStatusImpl: async () => "active",
    githubClient: { repository: "hara-lang/hara-world", baseBranch: "main", async request() {} },
    reviewAccessImpl: async () => ({ allowed: true, source: "profile-role", permission: null, roles: ["editor"] }),
    reviewStore: { list: async () => [proposal()] },
  });
  assert.equal(allowed.status, 200);
  const body = await allowed.json();
  assert.equal(body.reviewer.source, "profile-role");
  assert.equal(body.proposals.length, 1);
});

test("authorized review reconciliation discovers the whole repository queue", async () => {
  const calls = [];
  let listCount = 0;
  const response = await handleReview(request("/api/review/proposals", {
    method: "POST",
    marker: "review-reconcile",
  }), {
    env: ENV,
    now: NOW,
    communityAccountStatusImpl: async () => "active",
    githubClient: { repository: "hara-lang/hara-world", baseBranch: "main", async request() {} },
    reviewAccessImpl: async () => ({ allowed: true, source: "repository", permission: "maintain", roles: [] }),
    reviewStore: {
      async list() {
        listCount += 1;
        calls.push(["list", listCount]);
        return listCount === 1 ? [] : [proposal()];
      },
    },
    discoverManagedProposalsImpl: async (_client, options) => {
      calls.push(["discover", options.ownerGithubUserId ?? null]);
      return [{ ok: true, proposal: proposal() }];
    },
    reconcileProposalsImpl: async (items) => {
      calls.push(["reconcile", items.length]);
      return items.map((item) => ({ ok: true, proposal: item }));
    },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.reviewer.permission, "maintain");
  assert.deepEqual(calls.slice(0, 4), [
    ["list", 1],
    ["discover", null],
    ["list", 2],
    ["reconcile", 1],
  ]);
});
