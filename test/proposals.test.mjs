import assert from "node:assert/strict";
import test from "node:test";
import {
  applyProposalLifecycleEvent,
  groupProposalCounts,
  normalizeProposalSubmission,
  proposalIdFor,
  recordProposalSubmission,
} from "../netlify/functions/_shared/proposals.mjs";

const NOW = Date.parse("2026-08-18T00:00:00Z");
const INPUT = {
  proposalType: "post",
  ownerGithubUserId: "6685337",
  resourceKey: "11111111-1111-4111-8111-111111111111",
  resourceTitle: "A small Hara agent",
  repository: "hara-lang/hara-learn",
  branch: "post/github-6685337/1111111111114111",
  baseBranch: "main",
  pullRequestNumber: 42,
  pullRequestUrl: "https://github.com/hara-lang/hara-learn/pull/42",
  publicPath: "/articles/community/2026/08/6685337-small-hara-agent",
  headSha: "a".repeat(40),
  isDraft: true,
  submittedAt: "2026-08-18T00:00:00Z",
};

function row(overrides = {}) {
  return {
    proposal_id: proposalIdFor(INPUT.proposalType, INPUT.resourceKey),
    proposal_type: INPUT.proposalType,
    owner_github_user_id: INPUT.ownerGithubUserId,
    resource_key: INPUT.resourceKey,
    resource_title: INPUT.resourceTitle,
    repository: INPUT.repository,
    branch: INPUT.branch,
    base_branch: INPUT.baseBranch,
    pull_request_number: String(INPUT.pullRequestNumber),
    pull_request_url: INPUT.pullRequestUrl,
    public_path: INPUT.publicPath,
    head_sha: INPUT.headSha,
    state: "submitted",
    review_state: "pending",
    checks_state: "unknown",
    is_draft: "true",
    submitted_at: INPUT.submittedAt,
    updated_at: INPUT.submittedAt,
    merged_at: null,
    closed_at: null,
    last_reconciled_at: null,
    ...overrides,
  };
}

test("derives stable opaque proposal IDs and validates submission metadata", () => {
  const id = proposalIdFor("post", INPUT.resourceKey);
  assert.match(id, /^proposal:post:[0-9a-f]{24}$/);
  assert.equal(proposalIdFor("post", INPUT.resourceKey), id);
  assert.notEqual(proposalIdFor("source", INPUT.resourceKey), id);

  const normalized = normalizeProposalSubmission(INPUT, { now: NOW });
  assert.equal(normalized.proposalId, id);
  assert.equal(normalized.ownerGithubUserId, "6685337");
  assert.equal(normalized.headSha, "a".repeat(40));
  assert.equal(normalized.submittedAt, "2026-08-18T00:00:00.000Z");
  assert.throws(() => normalizeProposalSubmission({ ...INPUT, repository: "bad" }), /owner\/name/);
  assert.throws(() => normalizeProposalSubmission({ ...INPUT, pullRequestUrl: "https://example.com/pr/42" }), /github\.com/);
  assert.throws(() => normalizeProposalSubmission({ ...INPUT, publicPath: "articles/no-slash" }), /begin with a slash/);
});

test("records submission and an append-only local event in one transaction", async () => {
  const calls = [];
  const db = {
    async transaction(statements) {
      calls.push(statements);
      return [{ rows: [row()] }, { rows: [] }];
    },
  };
  const proposal = await recordProposalSubmission(INPUT, {
    db,
    now: NOW,
    actorGithubUserId: "6685337",
    actorLogin: "zcaudate",
  });
  assert.equal(proposal.proposalId, proposalIdFor("post", INPUT.resourceKey));
  assert.equal(proposal.isDraft, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 2);
  assert.match(calls[0][0].text, /ON CONFLICT \(proposal_type, resource_key\)/);
  assert.match(calls[0][0].text, /owner_github_user_id = EXCLUDED\.owner_github_user_id/);
  assert.match(calls[0][1].text, /community_proposal_events/);
  assert.equal(calls[0][1].params[2], "6685337");
});

test("refuses to update a resource when its stable owner does not match", async () => {
  const db = {
    async query() { return { rows: [] }; },
  };
  await assert.rejects(() => recordProposalSubmission(INPUT, {
    db,
    now: NOW,
    recordEvent: false,
  }), /owner does not match/);
});

test("deduplicates provider deliveries while returning the existing lifecycle state", async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (calls.length === 1) return { rows: [] };
      return { rows: [row({ state: "approved", review_state: "approved", is_draft: false })] };
    },
  };
  const result = await applyProposalLifecycleEvent({
    proposalId: proposalIdFor("post", INPUT.resourceKey),
    provider: "github",
    deliveryKey: "delivery-123",
    eventType: "github.pull_request_review",
    action: "submitted",
    state: "approved",
    reviewState: "approved",
    actorGithubUserId: "1455572",
    actorLogin: "hoebat",
  }, { db, now: NOW });
  assert.equal(result.accepted, false);
  assert.equal(result.proposal.state, "approved");
  assert.equal(result.proposal.isDraft, false);
  assert.match(calls[0].sql, /ON CONFLICT \(provider, provider_delivery_key\) DO NOTHING/);
  assert.equal(calls[0].params[2], "delivery-123");
});

test("summarizes open, review, publication, closure, and failing-check counts", () => {
  const counts = groupProposalCounts([
    { state: "submitted", reviewState: "pending", checksState: "passing" },
    { state: "changes-requested", reviewState: "changes-requested", checksState: "passing" },
    { state: "approved", reviewState: "approved", checksState: "failing" },
    { state: "merged", reviewState: "approved", checksState: "passing" },
    { state: "withdrawn", reviewState: "pending", checksState: "unknown" },
  ]);
  assert.deepEqual(counts, {
    total: 5,
    open: 3,
    changesRequested: 1,
    approved: 2,
    merged: 1,
    closed: 1,
    failing: 1,
  });
});
