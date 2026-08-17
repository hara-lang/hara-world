import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("My World presents the cross-resource lifecycle without replacing Git review", async () => {
  const page = await read("src/pages/me.astro");
  assert.match(page, /<h1>My World\.<\/h1>/);
  assert.match(page, /\/api\/proposals\/reconcile/);
  assert.match(page, /X-Hara-Request": "proposal-reconcile"/);
  assert.match(page, /Your proposal activity\./);
  assert.match(page, /Changes requested/);
  assert.match(page, /Open published record/);
  assert.match(page, /Technical review/);
  assert.match(page, /id="profile"/);
  assert.doesNotMatch(page, /\.innerHTML\s*=/);
});

test("the review queue is read-only, authority-gated, and lifecycle-aware", async () => {
  const [page, api] = await Promise.all([
    read("src/pages/review.astro"),
    read("netlify/functions/review-proposals.mjs"),
  ]);
  assert.match(page, /<h1>Review the World\.<\/h1>/);
  assert.match(page, /Attention/);
  assert.match(page, /Needs review/);
  assert.match(page, /Approved/);
  assert.match(page, /Recently resolved/);
  assert.match(page, /GitHub remains the place where review comments, approvals, and merges are recorded/);
  assert.match(api, /reviewAccess/);
  assert.match(api, /REVIEW_ACCESS_REQUIRED/);
  assert.match(api, /review-reconcile/);
  assert.doesNotMatch(page, /fetch\([^)]*approve|fetch\([^)]*merge/i);
  assert.doesNotMatch(page, /\.innerHTML\s*=/);
});

test("all four publishers record lifecycle state after GitHub returns a proposal", async () => {
  const files = await Promise.all([
    read("netlify/functions/posts.mjs"),
    read("netlify/functions/profile-proposal.mjs"),
    read("netlify/functions/agent-proposal.mjs"),
    read("netlify/functions/source-proposal.mjs"),
  ]);
  for (const source of files) {
    assert.match(source, /recordPublishedProposal/);
    assert.match(source, /lifecycleRecorded/);
  }
  assert.match(files[0], /markLifecycleWithdrawn/);
  assert.match(files[0], /proposalType: "post"/);
  assert.match(files[1], /proposalType: "profile"/);
  assert.match(files[2], /proposalType: "agent"/);
  assert.match(files[3], /proposalType: "source"/);
});

test("the proposal lifecycle has a migration, signed webhook, owner API, and scheduled repair", async () => {
  const [migration, webhook, ownerApi, schedule, readiness, env] = await Promise.all([
    read("database/migrations/005_community_proposals.sql"),
    read("netlify/functions/github-events.mjs"),
    read("netlify/functions/proposals.mjs"),
    read("netlify/functions/proposal-reconcile-scheduled.mjs"),
    read("netlify/functions/world-readiness.mjs"),
    read(".env.example"),
  ]);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS hara_world\.community_proposals/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS hara_world\.community_proposal_events/);
  assert.match(migration, /UNIQUE \(provider, provider_delivery_key\)/);
  assert.match(webhook, /verifyGitHubWebhookSignature/);
  assert.match(webhook, /x-github-delivery/);
  assert.match(webhook, /pull_request_review_comment/);
  assert.match(ownerApi, /discoverManagedProposals/);
  assert.match(ownerApi, /listProposalsForOwner/);
  assert.match(schedule, /schedule: "17 \* \* \* \*"/);
  assert.match(readiness, /github-proposal-webhook/);
  assert.match(readiness, /community_proposal_events/);
  assert.match(env, /HARA_WORLD_GITHUB_WEBHOOK_SECRET=/);
});
