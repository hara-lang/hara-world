import assert from "node:assert/strict";
import test from "node:test";
import {
  discoverManagedProposals,
  reconcileProposal,
  reconcileProposals,
} from "../netlify/functions/_shared/proposal-reconcile.mjs";
import { proposalIdFor } from "../netlify/functions/_shared/proposals.mjs";

const REPOSITORY = "hara-lang/hara-world";
const SHA = "c".repeat(40);

function sourcePull({ number = 44, owner = "6685337", sourceId = "hara-notes", state = "open", mergedAt = null } = {}) {
  return {
    number,
    title: "Source: Hara Notes",
    body: `<!-- hara-world-source-proposal -->\n<!-- hara-world-source:github:${owner}:${sourceId} -->`,
    state,
    draft: state === "open",
    merged: Boolean(mergedAt),
    merged_at: mergedAt,
    closed_at: state === "closed" ? "2026-08-18T03:00:00Z" : null,
    created_at: "2026-08-18T00:00:00Z",
    updated_at: "2026-08-18T02:00:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${number}`,
    base: { ref: "main", repo: { full_name: REPOSITORY } },
    head: { ref: `source-registry/github-${owner}/${sourceId}`, sha: SHA, repo: { full_name: REPOSITORY } },
  };
}

function profilePull({ number = 51, owner = "6685337" } = {}) {
  return {
    number,
    title: "Profile: @zcaudate",
    body: `<!-- hara-world-profile-proposal -->\n<!-- hara-world-profile:github:${owner} -->`,
    state: "open",
    draft: true,
    merged: false,
    merged_at: null,
    closed_at: null,
    created_at: "2026-08-18T00:00:00Z",
    updated_at: "2026-08-18T02:00:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${number}`,
    base: { ref: "main", repo: { full_name: REPOSITORY } },
    head: { ref: `profile/github-${owner}`, sha: SHA, repo: { full_name: REPOSITORY } },
  };
}

function postPull({ number = 52, owner = "6685337" } = {}) {
  const draftId = "11111111-1111-4111-8111-111111111111";
  return {
    number,
    title: "Post: Small Hara agent",
    body: [
      "<!-- hara-world-post-proposal -->",
      `<!-- hara-world-post:draft:${draftId} -->`,
      `<!-- hara-world-author:github:${owner} -->`,
    ].join("\n"),
    state: "open",
    draft: true,
    merged: false,
    merged_at: null,
    closed_at: null,
    created_at: "2026-08-18T00:00:00Z",
    updated_at: "2026-08-18T02:00:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${number}`,
    base: { ref: "main", repo: { full_name: REPOSITORY } },
    head: { ref: `post/github-${owner}/1111111111114111`, sha: SHA, repo: { full_name: REPOSITORY } },
  };
}

function recordedProposal() {
  return {
    proposalId: proposalIdFor("source", "hara-notes"),
    proposalType: "source",
    ownerGithubUserId: "6685337",
    resourceKey: "hara-notes",
    resourceTitle: "Hara Notes",
    repository: REPOSITORY,
    branch: "source-registry/github-6685337/hara-notes",
    baseBranch: "main",
    pullRequestNumber: 44,
    pullRequestUrl: `https://github.com/${REPOSITORY}/pull/44`,
    publicPath: "/sources",
    state: "submitted",
    reviewState: "pending",
    checksState: "unknown",
  };
}

test("discovers recent managed pull requests and filters them by stable owner", async () => {
  const recorded = [];
  const client = {
    repository: REPOSITORY,
    async request(path) {
      assert.match(path, /pulls\?state=all/);
      return [
        sourcePull(),
        sourcePull({ number: 45, owner: "9", sourceId: "other-feed" }),
        { ...sourcePull({ number: 46 }), head: { ...sourcePull({ number: 46 }).head, ref: "spoofed-branch" } },
      ];
    },
  };
  const result = await discoverManagedProposals(client, {
    ownerGithubUserId: "6685337",
    proposalStore: {
      async recordSubmission(descriptor, options) {
        recorded.push({ descriptor, options });
        return { ...recordedProposal(), proposalId: proposalIdFor(descriptor.proposalType, descriptor.resourceKey) };
      },
    },
    now: Date.parse("2026-08-18T04:00:00Z"),
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].ok, true);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].descriptor.ownerGithubUserId, "6685337");
  assert.equal(recorded[0].options.recordEvent, false);
  assert.equal(recorded[0].options.resetState, false);
});

test("repairs profile and post public paths from server-controlled pull-request file paths", async () => {
  const recorded = [];
  const client = {
    repository: REPOSITORY,
    async request(path) {
      if (path.includes("pulls?state=all")) return [profilePull(), postPull()];
      if (path === `/repos/${REPOSITORY}/pulls/51/files?per_page=100`) {
        return [
          { filename: "registry/profiles.json" },
          { filename: "content/profiles/chris-zheng.md" },
        ];
      }
      if (path === `/repos/${REPOSITORY}/pulls/52/files?per_page=100`) {
        return [{ filename: "content/articles/community/2026/08/6685337-small-hara-agent.md" }];
      }
      throw new Error(`Unexpected request: ${path}`);
    },
  };
  const result = await discoverManagedProposals(client, {
    ownerGithubUserId: "6685337",
    proposalStore: {
      async recordSubmission(descriptor) {
        recorded.push(descriptor);
        return { ...descriptor, proposalId: proposalIdFor(descriptor.proposalType, descriptor.resourceKey) };
      },
    },
  });
  assert.equal(result.length, 2);
  assert.equal(result.every((item) => item.ok), true);
  assert.equal(recorded.find((item) => item.proposalType === "profile").publicPath, "/people/chris-zheng/");
  assert.equal(recorded.find((item) => item.proposalType === "post").publicPath, "/articles/community/2026/08/6685337-small-hara-agent");
});

test("reconciles pull, review, and check state after verifying immutable markers", async () => {
  const proposal = recordedProposal();
  const applied = [];
  const client = {
    repository: REPOSITORY,
    async request(path) {
      if (path === `/repos/${REPOSITORY}/pulls/44`) return sourcePull();
      if (path.includes("/reviews?")) {
        return [{ user: { login: "reviewer" }, state: "APPROVED", submitted_at: "2026-08-18T02:30:00Z" }];
      }
      if (path.includes("/check-runs?")) {
        return { check_runs: [{ name: "Validate", status: "completed", conclusion: "success" }] };
      }
      throw new Error(`Unexpected request: ${path}`);
    },
  };
  const result = await reconcileProposal(proposal, client, {
    proposalStore: {
      async applyEvent(event) {
        applied.push(event);
        return { accepted: true, proposal: { ...proposal, ...event } };
      },
    },
    now: Date.parse("2026-08-18T04:00:00Z"),
  });
  assert.equal(result.state, "approved");
  assert.equal(result.reviewState, "approved");
  assert.equal(result.checksState, "passing");
  assert.equal(result.headSha, SHA);
  assert.match(applied[0].deliveryKey, /^proposal:hara-lang\/hara-world:44:/);
  assert.equal(applied[0].provider, "reconcile");
});

test("continues pull-request reconciliation when optional review or checks reads are forbidden", async () => {
  const proposal = recordedProposal();
  const client = {
    repository: REPOSITORY,
    async request(path) {
      if (path === `/repos/${REPOSITORY}/pulls/44`) return sourcePull();
      const error = new Error("Forbidden");
      error.status = 403;
      throw error;
    },
  };
  const result = await reconcileProposal(proposal, client, {
    proposalStore: {
      async applyEvent(event) {
        return { accepted: true, proposal: { ...proposal, ...event } };
      },
    },
  });
  assert.equal(result.state, "submitted");
  assert.equal(result.reviewState, "pending");
  assert.equal(result.checksState, "unknown");
});

test("rejects a pull request whose trusted markers no longer match the recorded owner or resource", async () => {
  const proposal = recordedProposal();
  const client = {
    repository: REPOSITORY,
    async request(path) {
      if (path === `/repos/${REPOSITORY}/pulls/44`) return sourcePull({ owner: "9" });
      throw new Error(`Unexpected request: ${path}`);
    },
  };
  await assert.rejects(() => reconcileProposal(proposal, client), /markers do not match/);
});

test("isolates one reconciliation failure without abandoning the rest of the queue", async () => {
  const good = recordedProposal();
  const bad = { ...recordedProposal(), proposalId: proposalIdFor("source", "bad"), resourceKey: "bad", pullRequestNumber: 99 };
  const client = {
    repository: REPOSITORY,
    async request(path) {
      if (path === `/repos/${REPOSITORY}/pulls/44`) return sourcePull();
      if (path.includes("/reviews?")) return [];
      if (path.includes("/check-runs?")) return { check_runs: [] };
      throw new Error("Not found");
    },
  };
  const result = await reconcileProposals([good, bad], client, {
    proposalStore: {
      async applyEvent(event) { return { accepted: true, proposal: { ...good, ...event } }; },
    },
  });
  assert.equal(result[0].ok, true);
  assert.equal(result[1].ok, false);
  assert.equal(result[1].error.code, "PROPOSAL_RECONCILE_FAILED");
});
