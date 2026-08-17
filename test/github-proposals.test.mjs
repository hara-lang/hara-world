import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  checksStateFromRuns,
  checksStateFromWebhook,
  proposalDescriptorFromPullRequest,
  pullRequestLifecycle,
  pullRequestNumberFromCheckPayload,
  reviewLifecycle,
  reviewStateFromReviews,
  verifyGitHubWebhookSignature,
} from "../netlify/functions/_shared/github-proposals.mjs";

const REPOSITORY = "hara-lang/hara-world";
const SHA = "a".repeat(40);

function pull({ number = 42, title, body, branch, state = "open", mergedAt = null, draft = true, headRepository = REPOSITORY } = {}) {
  return {
    number,
    title,
    body,
    state,
    draft,
    merged: Boolean(mergedAt),
    merged_at: mergedAt,
    closed_at: state === "closed" ? "2026-08-18T02:00:00Z" : null,
    created_at: "2026-08-18T00:00:00Z",
    updated_at: "2026-08-18T01:00:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${number}`,
    base: { ref: "main", repo: { full_name: REPOSITORY } },
    head: { ref: branch, sha: SHA, repo: { full_name: headRepository } },
  };
}

test("verifies GitHub webhook signatures using the configured SHA-256 secret", () => {
  const secret = "proposal-webhook-secret-0123456789";
  const body = JSON.stringify({ zen: "Hara" });
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  assert.equal(verifyGitHubWebhookSignature(body, signature, secret), true);
  assert.equal(verifyGitHubWebhookSignature(`${body}x`, signature, secret), false);
  assert.equal(verifyGitHubWebhookSignature(body, "sha256=bad", secret), false);
  assert.throws(() => verifyGitHubWebhookSignature(body, signature, "short"), /at least 32 characters/);
});

test("maps all managed proposal markers only when branch and repository provenance agree", () => {
  const draftId = "11111111-1111-4111-8111-111111111111";
  const cases = [
    {
      expected: { proposalType: "post", ownerGithubUserId: "6685337", resourceKey: draftId },
      pull: pull({
        title: "Post: Small agent",
        branch: "post/github-6685337/1111111111114111",
        body: `<!-- hara-world-post-proposal -->\n<!-- hara-world-post:draft:${draftId} -->\n<!-- hara-world-author:github:6685337 -->`,
      }),
    },
    {
      expected: { proposalType: "profile", ownerGithubUserId: "6685337", resourceKey: "github:6685337" },
      pull: pull({
        title: "Profile: @zcaudate",
        branch: "profile/github-6685337",
        body: "<!-- hara-world-profile-proposal -->\n<!-- hara-world-profile:github:6685337 -->",
      }),
    },
    {
      expected: { proposalType: "agent", ownerGithubUserId: "6685337", resourceKey: "agent:github:6685337:atlas" },
      pull: pull({
        title: "Agent: Atlas",
        branch: "agent-registry/github-6685337/atlas",
        body: "<!-- hara-world-agent-proposal -->\n<!-- hara-world-agent:agent:github:6685337:atlas -->",
      }),
    },
    {
      expected: { proposalType: "source", ownerGithubUserId: "6685337", resourceKey: "hara-notes" },
      pull: pull({
        title: "Source: Hara Notes",
        branch: "source-registry/github-6685337/hara-notes",
        body: "<!-- hara-world-source-proposal -->\n<!-- hara-world-source:github:6685337:hara-notes -->",
      }),
    },
  ];

  for (const fixture of cases) {
    const descriptor = proposalDescriptorFromPullRequest(fixture.pull);
    assert.equal(descriptor.proposalType, fixture.expected.proposalType);
    assert.equal(descriptor.ownerGithubUserId, fixture.expected.ownerGithubUserId);
    assert.equal(descriptor.resourceKey, fixture.expected.resourceKey);
    assert.equal(descriptor.repository, REPOSITORY);
    assert.equal(descriptor.headSha, SHA);
  }

  assert.equal(proposalDescriptorFromPullRequest({ ...cases[2].pull, head: { ...cases[2].pull.head, ref: "attacker/atlas" } }), null);
  assert.equal(proposalDescriptorFromPullRequest({ ...cases[3].pull, head: { ...cases[3].pull.head, repo: { full_name: "someone/fork" } } }), null);
  assert.equal(proposalDescriptorFromPullRequest(pull({ title: "Normal PR", branch: "feature", body: "No World markers" })), null);
});

test("maps pull request, review, and check lifecycle states without conflating them", () => {
  assert.deepEqual(pullRequestLifecycle(pull({ state: "open", draft: true })), { state: "submitted", isDraft: true });
  const merged = pullRequestLifecycle(pull({ state: "closed", draft: false, mergedAt: "2026-08-18T03:00:00Z" }));
  assert.equal(merged.state, "merged");
  assert.equal(merged.reviewState, "approved");
  assert.equal(merged.mergedAt, "2026-08-18T03:00:00Z");
  assert.equal(pullRequestLifecycle(pull({ state: "closed", draft: false })).state, "closed");

  assert.deepEqual(reviewLifecycle({ state: "APPROVED" }), { state: "approved", reviewState: "approved" });
  assert.deepEqual(reviewLifecycle({ state: "CHANGES_REQUESTED" }), { state: "changes-requested", reviewState: "changes-requested" });
  assert.deepEqual(reviewLifecycle({ state: "DISMISSED" }), { state: "submitted", reviewState: "dismissed" });

  const reviews = [
    { user: { login: "reviewer" }, state: "CHANGES_REQUESTED", submitted_at: "2026-08-18T00:00:00Z" },
    { user: { login: "reviewer" }, state: "APPROVED", submitted_at: "2026-08-18T01:00:00Z" },
    { user: { login: "second" }, state: "APPROVED", submitted_at: "2026-08-18T01:30:00Z" },
  ];
  assert.equal(reviewStateFromReviews(reviews), "approved");
  assert.equal(reviewStateFromReviews([...reviews, { user: { login: "third" }, state: "CHANGES_REQUESTED", submitted_at: "2026-08-18T02:00:00Z" }]), "changes-requested");

  assert.equal(checksStateFromRuns([]), "unknown");
  assert.equal(checksStateFromRuns([{ status: "in_progress", conclusion: null }]), "pending");
  assert.equal(checksStateFromRuns([{ status: "completed", conclusion: "success" }, { status: "completed", conclusion: "neutral" }]), "passing");
  assert.equal(checksStateFromRuns([{ status: "completed", conclusion: "failure" }]), "failing");
  assert.equal(checksStateFromWebhook({ check_suite: { status: "completed", conclusion: "success" } }), "passing");
  assert.equal(pullRequestNumberFromCheckPayload({ check_run: { pull_requests: [{ number: 77 }] } }), 77);
});
