import assert from "node:assert/strict";
import test from "node:test";
import { checkWorldReadiness } from "../netlify/functions/world-readiness.mjs";

const ENV = {
  HARA_WORLD_HANDOFF_SECRET: "h".repeat(64),
  HARA_WORLD_SESSION_SECRET: "s".repeat(64),
  HARA_WORLD_GITHUB_WEBHOOK_SECRET: "w".repeat(64),
};
const NOW = Date.parse("2026-08-18T00:00:00Z");

function identityDiscovery(origin = "https://id.hara-lang.org", world = "https://world.hara-lang.org") {
  return Response.json({
    configured: true,
    issuer: origin,
    codeChallengeMethodsSupported: ["S256"],
    clients: [{ id: "world", redirectUri: `${world}/api/auth/callback` }],
  });
}

function githubClient(permissions = { contents: "write", pull_requests: "write" }) {
  return {
    repository: "hara-lang/hara-world",
    baseBranch: "main",
    installationPermissions: permissions,
    async request(path) {
      if (path === "/repos/hara-lang/hara-world") return { full_name: "hara-lang/hara-world" };
      if (path === "/repos/hara-lang/hara-world/git/ref/heads/main") return { object: { sha: "abc" } };
      throw new Error(`Unexpected ${path}`);
    },
  };
}

const migratedDb = {
  async query() {
    return { rows: [{
      accounts: "hara_world.community_accounts",
      handoffs: "hara_world.community_identity_handoffs",
      post_drafts: "hara_world.community_post_drafts",
      post_events: "hara_world.community_post_events",
      proposals: "hara_world.community_proposals",
      proposal_events: "hara_world.community_proposal_events",
    }] };
  },
};

test("actively proves Identity, lifecycle migrations, webhook, GitHub permissions, repository, and branch", async () => {
  const result = await checkWorldReadiness(new Request("https://world.hara-lang.org/.well-known/hara-world-readiness"), {
    env: ENV,
    now: NOW,
    fetchImpl: async () => identityDiscovery(),
    db: migratedDb,
    githubClient: githubClient(),
  });
  assert.equal(result.ready, true);
  assert.equal(result.checks.every((item) => item.ready), true);
  assert.equal(result.centralIssuer, "https://id.hara-lang.org");
  assert.equal(result.checks.find((item) => item.name === "github-community-publisher").ready, true);
  assert.equal(result.checks.find((item) => item.name === "github-proposal-webhook").ready, true);
  assert.doesNotMatch(JSON.stringify(result), /hhhhhhhh|ssssssss|wwwwwwww|postgresql|PRIVATE KEY/);
});

test("fails closed for missing proposal migrations, webhook secret, or insufficient GitHub App permissions", async () => {
  const result = await checkWorldReadiness(new Request("https://world.testing.hara-lang.org/.well-known/hara-world-readiness"), {
    env: {
      HARA_WORLD_HANDOFF_SECRET: "h".repeat(64),
      HARA_WORLD_SESSION_SECRET: "s".repeat(64),
    },
    now: NOW,
    fetchImpl: async () => identityDiscovery("https://id.testing.hara-lang.org", "https://world.testing.hara-lang.org"),
    db: { async query() { return { rows: [{
      accounts: "hara_world.community_accounts",
      handoffs: "hara_world.community_identity_handoffs",
      post_drafts: "hara_world.community_post_drafts",
      post_events: "hara_world.community_post_events",
      proposals: null,
      proposal_events: null,
    }] }; } },
    githubClient: githubClient({ contents: "read", pull_requests: "write" }),
  });
  assert.equal(result.ready, false);
  assert.equal(result.checks.find((item) => item.name === "database").code, "proposal-lifecycle-migration-missing");
  assert.equal(result.checks.find((item) => item.name === "github-proposal-webhook").code, "github-webhook-not-configured");
  assert.equal(result.checks.find((item) => item.name === "github-community-publisher").code, "github-permissions-insufficient");
});
