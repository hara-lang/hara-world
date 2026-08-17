import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { handle } from "../netlify/functions/github-events.mjs";
import { proposalIdFor } from "../netlify/functions/_shared/proposals.mjs";

const SECRET = "github-proposal-webhook-secret-0123456789";
const REPOSITORY = "hara-lang/hara-world";
const SHA = "b".repeat(40);

function profilePull(overrides = {}) {
  return {
    number: 31,
    title: "Profile: @zcaudate",
    body: "<!-- hara-world-profile-proposal -->\n<!-- hara-world-profile:github:6685337 -->",
    state: "open",
    draft: true,
    merged: false,
    merged_at: null,
    closed_at: null,
    created_at: "2026-08-18T00:00:00Z",
    updated_at: "2026-08-18T00:30:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/31`,
    base: { ref: "main", repo: { full_name: REPOSITORY } },
    head: { ref: "profile/github-6685337", sha: SHA, repo: { full_name: REPOSITORY } },
    ...overrides,
  };
}

function signedRequest(event, delivery, payload, { signature = true } = {}) {
  const body = JSON.stringify(payload);
  const digest = createHmac("sha256", SECRET).update(body).digest("hex");
  return new Request("https://world.hara-lang.org/api/github/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": event,
      "X-GitHub-Delivery": delivery,
      "X-Hub-Signature-256": signature ? `sha256=${digest}` : `sha256=${"0".repeat(64)}`,
    },
    body,
  });
}

function fakeStore() {
  const proposals = new Map();
  const deliveries = new Set();
  const calls = [];
  return {
    calls,
    async findByPullRequest(repository, number) {
      return [...proposals.values()].find((proposal) => proposal.repository === repository && proposal.pullRequestNumber === number) ?? null;
    },
    async recordSubmission(descriptor) {
      const proposal = {
        proposalId: proposalIdFor(descriptor.proposalType, descriptor.resourceKey),
        proposalType: descriptor.proposalType,
        ownerGithubUserId: descriptor.ownerGithubUserId,
        resourceKey: descriptor.resourceKey,
        resourceTitle: descriptor.resourceTitle,
        repository: descriptor.repository,
        pullRequestNumber: descriptor.pullRequestNumber,
        pullRequestUrl: descriptor.pullRequestUrl,
        branch: descriptor.branch,
        state: "submitted",
      };
      proposals.set(proposal.proposalId, proposal);
      calls.push({ type: "record", descriptor });
      return proposal;
    },
    async applyEvent(event) {
      calls.push({ type: "event", event });
      const accepted = !deliveries.has(event.deliveryKey);
      deliveries.add(event.deliveryKey);
      const current = proposals.get(event.proposalId);
      const proposal = {
        ...current,
        state: event.state ?? current?.state,
        reviewState: event.reviewState ?? current?.reviewState ?? "pending",
        checksState: event.checksState ?? current?.checksState ?? "unknown",
      };
      proposals.set(event.proposalId, proposal);
      return { accepted, proposal };
    },
  };
}

test("rejects invalid signatures before parsing or applying repository state", async () => {
  const response = await handle(signedRequest("pull_request", "delivery-invalid", {
    repository: { full_name: REPOSITORY },
    action: "opened",
    pull_request: profilePull(),
  }, { signature: false }), { secret: SECRET, proposalStore: fakeStore() });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "WEBHOOK_SIGNATURE_INVALID");
});

test("records managed pull request lifecycle exactly once per GitHub delivery", async () => {
  const store = fakeStore();
  const payload = {
    repository: { full_name: REPOSITORY },
    action: "closed",
    sender: { id: 1455572, login: "hoebat" },
    pull_request: profilePull({
      state: "closed",
      draft: false,
      merged: true,
      merged_at: "2026-08-18T02:00:00Z",
      closed_at: "2026-08-18T02:00:00Z",
    }),
  };

  const first = await handle(signedRequest("pull_request", "delivery-merged", payload), {
    secret: SECRET,
    proposalStore: store,
    now: Date.parse("2026-08-18T02:00:01Z"),
  });
  const second = await handle(signedRequest("pull_request", "delivery-merged", payload), {
    secret: SECRET,
    proposalStore: store,
    now: Date.parse("2026-08-18T02:00:02Z"),
  });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).accepted, true);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).accepted, false);

  const events = store.calls.filter((call) => call.type === "event");
  assert.equal(events.length, 2);
  assert.equal(events[0].event.state, "merged");
  assert.equal(events[0].event.reviewState, "approved");
  assert.equal(events[0].event.actorGithubUserId, 1455572);
});

test("records review comments as activity without inventing a review decision", async () => {
  const store = fakeStore();
  const response = await handle(signedRequest("pull_request_review_comment", "delivery-comment", {
    repository: { full_name: REPOSITORY },
    action: "created",
    sender: { id: 10, login: "reviewer" },
    pull_request: profilePull(),
    comment: { id: 91, path: "content/profiles/chris.md", line: 12, user: { id: 10, login: "reviewer" } },
  }), { secret: SECRET, proposalStore: store });
  assert.equal(response.status, 200);
  const event = store.calls.find((call) => call.type === "event").event;
  assert.equal(event.state, undefined);
  assert.equal(event.reviewState, undefined);
  assert.equal(event.payload.commentId, 91);
  assert.equal(event.payload.path, "content/profiles/chris.md");
});

test("ignores another repository and check events not linked to a managed proposal", async () => {
  const mismatch = await handle(signedRequest("pull_request", "delivery-other", {
    repository: { full_name: "someone/other" },
    action: "opened",
    pull_request: profilePull(),
  }), { secret: SECRET, proposalStore: fakeStore() });
  assert.equal(mismatch.status, 202);
  assert.equal((await mismatch.json()).reason, "repository-mismatch");

  const check = await handle(signedRequest("check_run", "delivery-check", {
    repository: { full_name: REPOSITORY },
    action: "completed",
    check_run: {
      name: "Validate",
      status: "completed",
      conclusion: "failure",
      head_sha: SHA,
      pull_requests: [{ number: 999 }],
    },
  }), { secret: SECRET, proposalStore: fakeStore() });
  assert.equal(check.status, 202);
  assert.equal((await check.json()).reason, "unmanaged-pull-request");
});
